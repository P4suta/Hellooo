import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { DAY_MS } from "../../src/core/duration.ts";
import { formatDate } from "../../src/core/locale.ts";
import { messagesFor } from "../../src/core/messages.ts";
import { addMillis, type UserId } from "../../src/core/types.ts";
import { DAILY_REJECTION_LIMIT } from "../../src/core/weekly-cap.ts";
import { publicPath } from "../../src/worker/env.ts";
import { handleIncomingEmail } from "../../src/worker/intake.ts";
import {
	findUserByEmail,
	recordEvent,
	storeLetter,
} from "../../src/worker/repository.ts";
import htmlOnly from "../fixtures/letter-html-only.eml?raw";
import inJapanese from "../fixtures/letter-in-japanese.eml?raw";
import withDmarcPass from "../fixtures/letter-with-dmarc-pass.eml?raw";
import withUrl from "../fixtures/letter-with-url.eml?raw";
import withoutAuthentication from "../fixtures/letter-without-authentication.eml?raw";
import { mailSubject } from "../support/copy.ts";
import { must } from "../support/must.ts";
import { useEmptyStorage } from "./d1.ts";
import {
	address,
	CONFIG,
	creditsOf,
	eventKinds,
	fakeMessage,
	fakePorts,
	letterBodies,
	letterStatuses,
	pageKeyFor,
	seedActiveUser,
	T0,
	userCount,
	verifyTokenOf,
} from "./fakes.ts";
import { rawMail } from "./raw-mail.ts";

useEmptyStorage();

const LETTERS = CONFIG.LETTERS_ADDRESS;
const WRITER = "writer@example.com";

async function acceptedYesterday(
	ports: ReturnType<typeof fakePorts>,
	senderId: UserId,
): Promise<void> {
	const earlier = await storeLetter(env.DB, {
		id: ports.newId(),
		senderId,
		body: "earlier",
		status: "held",
		now: T0,
	});
	await env.DB.prepare(
		"UPDATE letters SET status = 'delivered', accepted_at = ? WHERE id = ?",
	)
		.bind(addMillis(T0, -DAY_MS), earlier.id)
		.run();
}

describe("a stranger writes", () => {
	it("is registered and the letter waits for the address to be confirmed", async () => {
		const ports = fakePorts();
		const message = fakeMessage(withDmarcPass, WRITER, LETTERS);
		await handleIncomingEmail(message, env, ports);
		const user = must(await findUserByEmail(env.DB, address(WRITER)));
		expect(user.status).toBe("pending");
		expect(user.locale).toBe("en");
		expect(await letterStatuses()).toEqual(["pending_verification"]);
		expect(await letterBodies()).toEqual([
			"Hellooo? Anybody there?\n\nIt is raining here today.",
		]);
		expect(message.replies).toHaveLength(1);
		expect(message.replies[0]?.subject).toBe(
			mailSubject(CONFIG.SERVICE_NAME, "en", (m) => m.verification),
		);
		expect(message.replies[0]?.text).toContain("/verify/token-1");
		expect(message.replies[0]?.from).toEqual({
			name: "Hellooo",
			email: LETTERS,
		});
		expect(await eventKinds()).toEqual(["user_registered"]);
		expect(ports.moderated).toHaveLength(0);
	});

	it("is answered in Japanese when the letter is written in Japanese", async () => {
		const ports = fakePorts();
		const message = fakeMessage(inJapanese, "kakite@example.jp", LETTERS);
		await handleIncomingEmail(message, env, ports);
		const user = must(
			await findUserByEmail(env.DB, address("kakite@example.jp")),
		);
		expect(user.locale).toBe("ja");
		expect(await letterBodies()).toEqual([
			"お～い、だれかいる～？\n\n今日は雨です。",
		]);
		expect(message.replies[0]?.subject).toBe(
			mailSubject(CONFIG.SERVICE_NAME, "ja", (m) => m.verification),
		);
		expect(message.replies[0]?.text).toContain(
			messagesFor("ja").mail.verification.intro,
		);
	});

	it("reads the words out of an HTML-only mail", async () => {
		const ports = fakePorts();
		const message = fakeMessage(htmlOnly, "richtext@example.com", LETTERS);
		await handleIncomingEmail(message, env, ports);
		expect(await letterBodies()).toEqual([
			"Hellooo from HTML & friends.\nSecond paragraph.",
		]);
	});

	it("is registered without a letter when the first mail carries a link", async () => {
		const ports = fakePorts();
		const message = fakeMessage(withUrl, WRITER, LETTERS);
		await handleIncomingEmail(message, env, ports);
		expect(await userCount()).toBe(1);
		expect(await letterStatuses()).toEqual([]);
		expect(message.replies[0]?.subject).toBe(
			mailSubject(CONFIG.SERVICE_NAME, "en", (m) => m.verification),
		);
	});

	it("gets silence when the mail did not pass DMARC", async () => {
		const ports = fakePorts();
		const message = fakeMessage(
			withoutAuthentication,
			"somebody@example.net",
			LETTERS,
		);
		await handleIncomingEmail(message, env, ports);
		expect(
			await findUserByEmail(env.DB, address("somebody@example.net")),
		).toBeNull();
		expect(await letterStatuses()).toEqual([]);
		expect(message.replies).toHaveLength(0);
		expect(ports.sent).toHaveLength(0);
		expect(await eventKinds()).toEqual(["mail_ignored"]);
	});

	it("is ignored when the mail was not addressed to the letters address", async () => {
		const ports = fakePorts();
		const message = fakeMessage(withDmarcPass, WRITER, CONFIG.NOTICES_ADDRESS);
		await handleIncomingEmail(message, env, ports);
		expect(await userCount()).toBe(0);
		expect(message.replies).toHaveLength(0);
		expect(await eventKinds()).toEqual(["mail_ignored"]);
	});

	it("is ignored when the envelope sender is not an address", async () => {
		const ports = fakePorts();
		const message = fakeMessage(withDmarcPass, "not an address", LETTERS);
		await handleIncomingEmail(message, env, ports);
		expect(await userCount()).toBe(0);
		expect(await eventKinds()).toEqual(["mail_ignored"]);
	});
});

describe("a pending sender writes again", () => {
	it("receives a fresh verification link and keeps one account", async () => {
		const ports = fakePorts();
		await handleIncomingEmail(
			fakeMessage(withDmarcPass, WRITER, LETTERS),
			env,
			ports,
		);
		const firstToken = await verifyTokenOf(WRITER);
		const again = fakeMessage(withDmarcPass, WRITER, LETTERS);
		await handleIncomingEmail(again, env, ports);
		expect(await userCount()).toBe(1);
		expect(await verifyTokenOf(WRITER)).not.toBe(firstToken);
		expect(again.replies[0]?.text).toContain(must(await verifyTokenOf(WRITER)));
		expect(await letterStatuses()).toEqual([
			"pending_verification",
			"pending_verification",
		]);
		expect(await eventKinds()).toEqual([
			"user_registered",
			"verification_sent",
		]);
	});

	it("stays silent without DMARC", async () => {
		const ports = fakePorts();
		await handleIncomingEmail(
			fakeMessage(withDmarcPass, WRITER, LETTERS),
			env,
			ports,
		);
		const unsigned = fakeMessage(withoutAuthentication, WRITER, LETTERS);
		await handleIncomingEmail(unsigned, env, ports);
		expect(unsigned.replies).toHaveLength(0);
		expect(ports.sent).toHaveLength(0);
		expect(await letterStatuses()).toEqual(["pending_verification"]);
	});
});

describe("a registered sender writes", () => {
	it("has the letter moderated, started on its journey, and credited", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, WRITER);
		const message = fakeMessage(withDmarcPass, WRITER, LETTERS);
		await handleIncomingEmail(message, env, ports);
		expect(ports.moderated).toEqual([
			"Hellooo? Anybody there?\n\nIt is raining here today.",
		]);
		expect(await letterStatuses()).toEqual(["traveling"]);
		expect(await creditsOf(writer)).toBe(1);
		expect(message.replies[0]?.subject).toBe(
			mailSubject(CONFIG.SERVICE_NAME, "en", (m) => m.accepted),
		);
		expect(await eventKinds()).toEqual(["user_verified", "letter_accepted"]);
	});

	it("hears that this week's letter already went out", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, WRITER);
		await acceptedYesterday(ports, writer.id);
		const message = fakeMessage(withDmarcPass, WRITER, LETTERS);
		await handleIncomingEmail(message, env, ports);
		expect(await letterStatuses()).toEqual(["delivered"]);
		expect(ports.moderated).toHaveLength(0);
		expect(message.replies[0]?.subject).toBe(
			mailSubject(CONFIG.SERVICE_NAME, "en", (m) => m.overCap),
		);
		expect(message.replies[0]?.text).toContain(
			formatDate("en", addMillis(T0, 6 * DAY_MS)),
		);
		expect(await eventKinds()).toContain("letter_over_cap");
	});

	it("hears the weekly limit in Japanese when registered in Japanese", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, WRITER, 0, "ja");
		await acceptedYesterday(ports, writer.id);
		const message = fakeMessage(withDmarcPass, WRITER, LETTERS);
		await handleIncomingEmail(message, env, ports);
		expect(message.replies[0]?.subject).toBe(
			mailSubject(CONFIG.SERVICE_NAME, "ja", (m) => m.overCap),
		);
		expect(message.replies[0]?.text).toContain(
			formatDate("ja", addMillis(T0, 6 * DAY_MS)),
		);
	});

	it("hears that a refused letter can't go out", async () => {
		const ports = fakePorts({ verdict: "reject" });
		const writer = await seedActiveUser(ports, WRITER);
		const message = fakeMessage(withDmarcPass, WRITER, LETTERS);
		await handleIncomingEmail(message, env, ports);
		expect(await letterStatuses()).toEqual(["rejected"]);
		expect(await creditsOf(writer)).toBe(0);
		expect(message.replies[0]?.subject).toBe(
			mailSubject(CONFIG.SERVICE_NAME, "en", (m) => m.cannotTravel),
		);
		expect(await eventKinds()).toContain("letter_rejected");
	});

	it("hears that the letter is on its way even while the model cannot be asked, and the letter waits", async () => {
		const ports = fakePorts({ verdict: null });
		const writer = await seedActiveUser(ports, WRITER);
		const message = fakeMessage(withDmarcPass, WRITER, LETTERS);
		await handleIncomingEmail(message, env, ports);
		expect(await letterStatuses()).toEqual(["held"]);
		expect(await creditsOf(writer)).toBe(0);
		expect(message.replies[0]?.subject).toBe(
			mailSubject(CONFIG.SERVICE_NAME, "en", (m) => m.accepted),
		);
		expect(message.replies[0]?.text).toContain(
			publicPath("you", pageKeyFor(WRITER)),
		);
		expect(await eventKinds()).toContain("letter_held");
	});

	it("hears that a letter with a link can't go out, before any moderation", async () => {
		const ports = fakePorts();
		await seedActiveUser(ports, WRITER);
		const message = fakeMessage(withUrl, WRITER, LETTERS);
		await handleIncomingEmail(message, env, ports);
		expect(ports.moderated).toHaveLength(0);
		expect(await letterStatuses()).toEqual([]);
		expect(message.replies[0]?.subject).toBe(
			mailSubject(CONFIG.SERVICE_NAME, "en", (m) => m.cannotTravel),
		);
		expect(message.replies[0]?.text).toContain(
			messagesFor("en").mail.cannotTravel.problems.url,
		);
		expect(await eventKinds()).toContain("letter_rejected");
	});

	it("hears that the nothing more today after the daily rejection limit", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, WRITER);
		for (let i = 0; i < DAILY_REJECTION_LIMIT; i += 1) {
			await recordEvent(env.DB, {
				kind: "letter_rejected",
				userId: writer.id,
				now: T0,
			});
		}
		const message = fakeMessage(withDmarcPass, WRITER, LETTERS);
		await handleIncomingEmail(message, env, ports);
		expect(ports.moderated).toHaveLength(0);
		expect(await letterStatuses()).toEqual([]);
		expect(message.replies[0]?.subject).toBe(
			mailSubject(CONFIG.SERVICE_NAME, "en", (m) => m.exhausted),
		);
		expect(await eventKinds()).toContain("rejections_exhausted");
	});

	it("receives a confirmation link at the registered address when the mail lacks DMARC", async () => {
		const ports = fakePorts();
		await seedActiveUser(ports, "somebody@example.net", 0, "ja");
		const message = fakeMessage(
			withoutAuthentication,
			"somebody@example.net",
			LETTERS,
		);
		await handleIncomingEmail(message, env, ports);
		expect(await letterStatuses()).toEqual(["pending_confirmation"]);
		expect(message.replies).toHaveLength(0);
		expect(ports.sent).toHaveLength(1);
		expect(ports.sent[0]?.to).toBe("somebody@example.net");
		expect(ports.sent[0]?.mail.subject).toBe(
			mailSubject(CONFIG.SERVICE_NAME, "ja", (m) => m.confirmation),
		);
		expect(ports.sent[0]?.mail.text).toContain("/confirm/token-");
		expect(ports.sent[0]?.mail.text).toContain(
			messagesFor("ja").mail.confirmation.intro,
		);
		expect(await eventKinds()).toContain("confirmation_sent");
	});

	it("stops letters to an address the provider refuses instead of confirming through it", async () => {
		const ports = fakePorts();
		const user = await seedActiveUser(ports, "somebody@example.net");
		ports.suppressed.add(user.email);
		await handleIncomingEmail(
			fakeMessage(withoutAuthentication, "somebody@example.net", LETTERS),
			env,
			ports,
		);
		expect(await letterStatuses()).toEqual(["pending_confirmation"]);
		expect(ports.sent).toHaveLength(0);
		expect(
			must(await findUserByEmail(env.DB, address("somebody@example.net")))
				.status,
		).toBe("suppressed");
		expect(await eventKinds()).toContain("user_suppressed");
		expect(await eventKinds()).not.toContain("confirmation_sent");
	});

	it("records a confirmation mail the provider failed to take, by the kind of mail alone", async () => {
		const ports = fakePorts();
		ports.failSending = true;
		await seedActiveUser(ports, "somebody@example.net");
		await handleIncomingEmail(
			fakeMessage(withoutAuthentication, "somebody@example.net", LETTERS),
			env,
			ports,
		);
		expect(await letterStatuses()).toEqual(["pending_confirmation"]);
		const { results } = await env.DB.prepare(
			"SELECT kind, detail FROM events WHERE kind = 'send_failed'",
		).all<{ kind: string; detail: string | null }>();
		expect(results).toEqual([{ kind: "send_failed", detail: "confirmation" }]);
		expect(await eventKinds()).not.toContain("confirmation_sent");
	});

	it("gets nothing at all when an unsigned mail would be refused anyway", async () => {
		const ports = fakePorts();
		await seedActiveUser(ports, WRITER);
		const message = fakeMessage(
			withUrl.replace(/^Authentication-Results:.*\r?\n/m, ""),
			WRITER,
			LETTERS,
		);
		await handleIncomingEmail(message, env, ports);
		expect(message.replies).toHaveLength(0);
		expect(ports.sent).toHaveLength(0);
		expect(await letterStatuses()).toEqual([]);
		expect(await eventKinds()).toContain("mail_ignored");
	});

	it("is ignored after unsubscribing", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, WRITER);
		await env.DB.prepare(
			"UPDATE users SET status = 'unsubscribed' WHERE id = ?",
		)
			.bind(writer.id)
			.run();
		const message = fakeMessage(withDmarcPass, WRITER, LETTERS);
		await handleIncomingEmail(message, env, ports);
		expect(message.replies).toHaveLength(0);
		expect(await letterStatuses()).toEqual([]);
		expect(await eventKinds()).toContain("mail_ignored");
	});

	it("records a refused reply without losing the accepted letter", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, WRITER);
		const message = fakeMessage(withDmarcPass, WRITER, LETTERS, {
			replyFails: true,
		});
		await handleIncomingEmail(message, env, ports);
		expect(await letterStatuses()).toEqual(["traveling"]);
		expect(await creditsOf(writer)).toBe(1);
		expect(message.replies).toHaveLength(0);
		expect(await eventKinds()).toContain("reply_failed");
	});
});

describe("automatic or misattributed mail", () => {
	const personal = (
		extraHeaders: readonly string[] = [],
		headerFrom?: string,
	): string =>
		rawMail({
			from: WRITER,
			body: "Hellooo? Anybody there?",
			extraHeaders,
			...(headerFrom === undefined ? {} : { headerFrom }),
		});

	it("is ignored when the From header names someone other than the envelope sender", async () => {
		const ports = fakePorts();
		const message = fakeMessage(
			personal([], "victim@example.org"),
			WRITER,
			LETTERS,
		);
		await handleIncomingEmail(message, env, ports);
		expect(await userCount()).toBe(0);
		expect(message.replies).toHaveLength(0);
		expect(ports.sent).toHaveLength(0);
		expect(await eventKinds()).toEqual(["mail_ignored"]);
	});

	it.each([
		"Auto-Submitted: auto-replied",
		"Auto-Submitted: auto-generated",
		"List-Id: <letters.example.com>",
		"List-Unsubscribe: <mailto:leave@example.com>",
		"Precedence: bulk",
		"Precedence: list",
	])(
		"is ignored when it carries %s, even from a registered sender",
		async (header) => {
			const ports = fakePorts();
			await seedActiveUser(ports, WRITER);
			const message = fakeMessage(personal([header]), WRITER, LETTERS);
			await handleIncomingEmail(message, env, ports);
			expect(await letterStatuses()).toEqual([]);
			expect(message.replies).toHaveLength(0);
			expect(ports.sent).toHaveLength(0);
			expect(await eventKinds()).toContain("mail_ignored");
		},
	);

	it("is ignored when the service writes to itself", async () => {
		const ports = fakePorts();
		for (const own of [LETTERS, CONFIG.NOTICES_ADDRESS]) {
			const message = fakeMessage(
				rawMail({ from: own, body: "loop" }),
				own,
				LETTERS,
			);
			await handleIncomingEmail(message, env, ports);
			expect(message.replies).toHaveLength(0);
		}
		expect(await userCount()).toBe(0);
		expect(await eventKinds()).toEqual(["mail_ignored", "mail_ignored"]);
	});

	it("is handled when Auto-Submitted says no and Precedence is ordinary", async () => {
		const ports = fakePorts();
		const message = fakeMessage(
			personal(["Auto-Submitted: no", "Precedence: first-class"]),
			WRITER,
			LETTERS,
		);
		await handleIncomingEmail(message, env, ports);
		expect(await userCount()).toBe(1);
		expect(message.replies).toHaveLength(1);
	});
});
