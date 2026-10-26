import { env } from "cloudflare:workers";
import type { ModerationVerdict } from "../../src/core/intake-decision.ts";
import { unitInterval } from "../../src/core/journey-schedule.ts";
import type { Locale } from "../../src/core/locale.ts";
import {
	type EmailAddress,
	type Instant,
	instant,
	type UserId,
	userId,
} from "../../src/core/types.ts";
import { readConfig } from "../../src/worker/env.ts";
import type { OutboundMail, Ports } from "../../src/worker/ports.ts";
import {
	createPendingUser,
	type Letter,
	storeLetter,
	type User,
	verifyUser,
} from "../../src/worker/repository.ts";
import { must } from "../support/must.ts";

export const T0 = must(instant(1_800_000_000_000));

/** The configuration of the test Worker, so tests name addresses and the service name from one place. */
export const CONFIG = readConfig(env);

/** The one token the fake sign-in accepts as the operator's. */
export const OPERATOR_TOKEN = "operator-token";
export const OPERATOR_EMAIL = "operator@example.com";

/** The page key that `seedActiveUser` gives an address, so tests can open the page about it. */
export function pageKeyFor(email: string): string {
	return `page-${email}`;
}

export type FakePorts = Ports & {
	readonly sent: OutboundMail[];
	readonly moderated: string[];
	verdict: ModerationVerdict | null;
	clock: Instant;
	u: number;
	failSending: boolean;
	/** The addresses the fake provider refuses as suppressed. */
	readonly suppressed: Set<string>;
};

/** Deterministic effects: a settable clock, a settable uniform, counted tokens, a fixed verdict, recorded mail, and one operator token. */
export function fakePorts(
	initial: {
		verdict?: ModerationVerdict | null;
		now?: Instant;
		uniform?: number;
	} = {},
): FakePorts {
	let counter = 0;
	const fake: FakePorts = {
		sent: [],
		moderated: [],
		verdict: initial.verdict === undefined ? "deliver" : initial.verdict,
		clock: initial.now ?? T0,
		u: initial.uniform ?? 0,
		failSending: false,
		suppressed: new Set(),
		now: () => fake.clock,
		uniform: () => must(unitInterval(fake.u)),
		token: () => {
			counter += 1;
			return `token-${counter}`;
		},
		newId: () => {
			counter += 1;
			return `id-${counter}`;
		},
		moderate: async (text) => {
			fake.moderated.push(text);
			return fake.verdict;
		},
		send: async (mail) => {
			if (fake.failSending) {
				return { kind: "failed", reason: "E_TEST_DOWN" };
			}
			if (fake.suppressed.has(mail.to)) {
				return { kind: "suppressed" };
			}
			fake.sent.push(mail);
			return { kind: "sent", messageId: `provider-${fake.sent.length}` };
		},
		operator: async (token) =>
			token === OPERATOR_TOKEN ? { email: OPERATOR_EMAIL } : null,
	};
	return fake;
}

export type FakeMessage = ForwardableEmailMessage & {
	readonly replies: EmailReplyMessageBuilder[];
};

export function fakeMessage(
	raw: string,
	from: string,
	to: string,
	options: { replyFails?: boolean } = {},
): FakeMessage {
	const replies: EmailReplyMessageBuilder[] = [];
	const bytes = new TextEncoder().encode(raw);
	return {
		from,
		to,
		headers: new Headers(),
		raw: new Blob([bytes]).stream(),
		rawSize: bytes.byteLength,
		replies,
		setReject: () => {
			throw new Error("the intake never rejects at SMTP level");
		},
		forward: () => {
			throw new Error("the intake never forwards");
		},
		reply: async (message: EmailMessage | EmailReplyMessageBuilder) => {
			if (!("subject" in message)) {
				throw new Error("the intake replies with a builder");
			}
			if (options.replyFails === true) {
				throw new Error("reply refused by the simulator");
			}
			replies.push(message);
			return { messageId: `reply-${replies.length}` };
		},
	};
}

export function address(raw: string): EmailAddress {
	return raw as EmailAddress;
}

export function id(raw: string): UserId {
	return must(userId(raw));
}

/** A verified user who can send and receive. */
export async function seedActiveUser(
	ports: Ports,
	email: string,
	credits = 0,
	locale: Locale = "en",
): Promise<User> {
	const pending = await createPendingUser(env.DB, {
		id: ports.newId(),
		email: address(email),
		verifyToken: `verify-${email}`,
		pageKey: pageKeyFor(email),
		locale,
		now: ports.now(),
	});
	const verified = must(
		await verifyUser(env.DB, `verify-${email}`, ports.now()),
	);
	if (credits > 0) {
		await env.DB.prepare("UPDATE users SET credits = ? WHERE id = ?")
			.bind(credits, pending.id)
			.run();
	}
	return { ...verified.user, credits };
}

export async function seedTravelingLetter(
	ports: Ports,
	sender: User,
	deliverAfter: Instant,
	body = "Hellooo? Anybody there?",
): Promise<Letter> {
	const letter = await storeLetter(env.DB, {
		id: ports.newId(),
		senderId: sender.id,
		body,
		status: "held",
		now: ports.now(),
	});
	await env.DB.prepare(
		"UPDATE letters SET status = 'traveling', accepted_at = ?, deliver_after = ? WHERE id = ?",
	)
		.bind(ports.now(), deliverAfter, letter.id)
		.run();
	return {
		...letter,
		status: "traveling",
		acceptedAt: ports.now(),
		deliverAfter,
	};
}

/** A letter still waiting for the model's verdict. */
export async function seedHeldLetter(
	ports: Ports,
	sender: User,
	body = "Hellooo? Anybody there?",
): Promise<Letter> {
	return storeLetter(env.DB, {
		id: ports.newId(),
		senderId: sender.id,
		body,
		status: "held",
		now: ports.now(),
	});
}

export async function letterStatuses(): Promise<string[]> {
	const { results } = await env.DB.prepare(
		"SELECT status FROM letters ORDER BY created_at, id",
	).all<{ status: string }>();
	return results.map((row) => row.status);
}

export async function letterBodies(): Promise<string[]> {
	const { results } = await env.DB.prepare(
		"SELECT body FROM letters ORDER BY created_at, id",
	).all<{ body: string }>();
	return results.map((row) => row.body);
}

export async function creditsOf(user: User): Promise<number> {
	const row = await env.DB.prepare("SELECT credits FROM users WHERE id = ?")
		.bind(user.id)
		.first<{ credits: number }>();
	return must(row).credits;
}

export async function eventKinds(): Promise<string[]> {
	const { results } = await env.DB.prepare(
		"SELECT kind FROM events ORDER BY id",
	).all<{ kind: string }>();
	return results.map((row) => row.kind);
}

export async function userCount(): Promise<number> {
	const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{
		n: number;
	}>();
	return must(row).n;
}

export async function verifyTokenOf(email: string): Promise<string | null> {
	const row = await env.DB.prepare(
		"SELECT verify_token FROM users WHERE email = ?",
	)
		.bind(email)
		.first<{ verify_token: string | null }>();
	return must(row).verify_token;
}
