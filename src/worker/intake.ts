import PostalMime from "postal-mime";
import { dmarcResult } from "../core/authentication-results.ts";
import { normalizeEmailAddress } from "../core/email-address.ts";
import { plainTextOfHtml } from "../core/html-text.ts";
import {
	decideIntake,
	type IntakeDecision,
	type KnownSender,
} from "../core/intake-decision.ts";
import { type LetterText, prepareLetterText } from "../core/letter-text.ts";
import {
	DEFAULT_LOCALE,
	detectLocaleFromText,
	type Locale,
	localeFromContentLanguage,
} from "../core/locale.ts";
import { originProblem } from "../core/mail-origin.ts";
import {
	acceptedMail,
	confirmationMail,
	type Mail,
	overCapMail,
	rejectedContentMail,
	rejectedTextMail,
	rejectionsExhaustedMail,
	verificationMail,
} from "../core/reply-text.ts";
import type { EmailAddress, Instant } from "../core/types.ts";
import { confirmationsRemaining } from "../core/weekly-cap.ts";
import { type AdmissionOutcome, admitLetter } from "./admission.ts";
import { type Config, publicLink, readConfig } from "./env.ts";
import { type Ports, productionPorts } from "./ports.ts";
import {
	confirmationsInLastDay,
	createPendingUser,
	findUserByEmail,
	lastAcceptedAt,
	pageKeyOf,
	recordEvent,
	refreshVerifyToken,
	rejectionsInLastDay,
	storeLetter,
	type User,
} from "./repository.ts";
import { noteRefusedMail } from "./sending.ts";

const AUTHENTICATION_RESULTS = "authentication-results";
const CONTENT_LANGUAGE = "content-language";

type Incoming = {
	readonly message: ForwardableEmailMessage;
	readonly sender: EmailAddress;
	readonly text: LetterText;
	readonly locale: Locale;
	readonly config: Config;
	readonly db: D1Database;
	readonly ports: Ports;
	readonly now: Instant;
};

export async function handleIncomingEmail(
	message: ForwardableEmailMessage,
	env: Env,
	ports: Ports = productionPorts(env, readConfig(env)),
): Promise<void> {
	const config = readConfig(env);
	const db = env.DB;
	const now = ports.now();
	const sender = normalizeEmailAddress(message.from);
	if (
		sender === null ||
		normalizeEmailAddress(message.to) !== config.LETTERS_ADDRESS
	) {
		await recordEvent(db, { kind: "mail_ignored", detail: "unroutable", now });
		return;
	}
	const parsed = await PostalMime.parse(message.raw);
	const headerFrom =
		parsed.from?.address === undefined
			? null
			: normalizeEmailAddress(parsed.from.address);
	const origin = originProblem({
		envelopeFrom: sender,
		headerFrom,
		ownAddresses: [config.LETTERS_ADDRESS, config.NOTICES_ADDRESS],
		headers: parsed.headers,
	});
	if (origin !== null) {
		await recordEvent(db, { kind: "mail_ignored", detail: origin, now });
		return;
	}
	const headerValues = (name: string): string[] =>
		parsed.headers
			.filter((header) => header.key === name)
			.map((header) => header.value);
	const dmarc = dmarcResult(headerValues(AUTHENTICATION_RESULTS));
	const text = prepareLetterText(
		parsed.text ??
			(parsed.html === undefined ? "" : plainTextOfHtml(parsed.html)),
	);
	const user = await findUserByEmail(db, sender);
	const locale =
		user?.locale ??
		localeFromContentLanguage(headerValues(CONTENT_LANGUAGE)[0]) ??
		(text.ok ? detectLocaleFromText(text.text) : null) ??
		DEFAULT_LOCALE;
	const known = user === null ? null : await knownSender(db, user, now);
	const decision = decideIntake({ sender: known, dmarc, now, text });
	await apply(decision, user, {
		message,
		sender,
		text,
		locale,
		config,
		db,
		ports,
		now,
	});
}

async function knownSender(
	db: D1Database,
	user: User,
	now: Instant,
): Promise<KnownSender> {
	return {
		id: user.id,
		status: user.status,
		lastAcceptedAt: await lastAcceptedAt(db, user.id),
		rejectionsInLastDay: await rejectionsInLastDay(db, user.id, now),
	};
}

async function apply(
	decision: IntakeDecision,
	user: User | null,
	incoming: Incoming,
): Promise<void> {
	const { config, db, ports, now, sender, text, locale } = incoming;
	switch (decision.kind) {
		case "ignore":
			await recordEvent(db, {
				kind: "mail_ignored",
				detail: decision.reason,
				now,
			});
			return;
		case "register": {
			const verifyToken = ports.token();
			const registered =
				user ??
				(await createPendingUser(db, {
					id: ports.newId(),
					email: sender,
					verifyToken,
					pageKey: ports.token(),
					locale,
					now,
				}));
			if (user !== null) {
				await refreshVerifyToken(db, user.id, verifyToken);
			}
			if (decision.storeLetter && text.ok) {
				await storeLetter(db, {
					id: ports.newId(),
					senderId: registered.id,
					body: text.text,
					status: "pending_verification",
					now,
				});
			}
			await recordEvent(db, {
				kind: user === null ? "user_registered" : "verification_sent",
				userId: registered.id,
				now,
			});
			await reply(
				incoming,
				verificationMail(
					locale,
					config.SERVICE_NAME,
					publicLink(config, "verify", verifyToken),
				),
			);
			return;
		}
		case "confirm": {
			if (user === null || !text.ok) {
				return;
			}
			// An unauthenticated mail costs the registered address one confirmation mail, so a day allows only a few before the rest pass in silence.
			if (
				confirmationsRemaining(
					await confirmationsInLastDay(db, user.id, now),
				) === 0
			) {
				return;
			}
			const confirmToken = ports.token();
			await storeLetter(db, {
				id: ports.newId(),
				senderId: user.id,
				body: text.text,
				status: "pending_confirmation",
				confirmToken,
				now,
			});
			const outcome = await ports.send({
				to: user.email,
				mail: confirmationMail(
					locale,
					config.SERVICE_NAME,
					publicLink(config, "confirm", confirmToken),
				),
			});
			if (outcome.kind !== "sent") {
				await noteRefusedMail(db, user.id, outcome, "confirmation", now);
				return;
			}
			await recordEvent(db, {
				kind: "confirmation_sent",
				userId: user.id,
				now,
			});
			return;
		}
		case "over-cap":
			await recordEvent(db, { kind: "letter_over_cap", userId: user?.id, now });
			await reply(
				incoming,
				overCapMail(locale, config.SERVICE_NAME, decision.nextAllowedAt),
			);
			return;
		case "rejections-exhausted":
			await recordEvent(db, {
				kind: "rejections_exhausted",
				userId: user?.id,
				now,
			});
			await reply(
				incoming,
				rejectionsExhaustedMail(locale, config.SERVICE_NAME),
			);
			return;
		case "reject-text":
			await recordEvent(db, {
				kind: "letter_rejected",
				userId: user?.id,
				detail: decision.problem,
				now,
			});
			await reply(
				incoming,
				rejectedTextMail(locale, config.SERVICE_NAME, decision.problem),
			);
			return;
		case "moderate": {
			if (user === null || !text.ok) {
				return;
			}
			const letter = await storeLetter(db, {
				id: ports.newId(),
				senderId: user.id,
				body: text.text,
				status: "held",
				now,
			});
			const outcome = await admitLetter(db, ports, letter, now);
			await reply(
				incoming,
				outcomeMail(
					locale,
					config.SERVICE_NAME,
					outcome,
					publicLink(config, "you", await pageKeyOf(db, user.id)),
				),
			);
			return;
		}
	}
}

/** A letter the model could not be asked about is taken all the same; the writer hears of a refusal later only if there is one. */
export function outcomeMail(
	locale: Locale,
	serviceName: string,
	outcome: AdmissionOutcome,
	youLink: string,
): Mail {
	switch (outcome.kind) {
		case "accept":
		case "retry-later":
			return acceptedMail(locale, serviceName, youLink);
		case "reject-content":
			return rejectedContentMail(locale, serviceName);
		case "over-cap":
			return overCapMail(locale, serviceName, outcome.nextAllowedAt);
	}
}

/** Answers through the Email Workers reply API, which Cloudflare permits only for mail with a valid DMARC result. */
async function reply(incoming: Incoming, mail: Mail): Promise<void> {
	const { message, config, db, now } = incoming;
	try {
		await message.reply({
			from: { name: config.SERVICE_NAME, email: config.LETTERS_ADDRESS },
			subject: mail.subject,
			text: mail.text,
		});
	} catch (error) {
		// The name alone is logged: a provider's message may quote the mail, and the log never carries a sender's words.
		console.warn(
			"reply refused",
			error instanceof Error ? error.name : typeof error,
		);
		await recordEvent(db, { kind: "reply_failed", now });
	}
}
