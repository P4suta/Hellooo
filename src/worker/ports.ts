import type { ModerationVerdict } from "../core/intake-decision.ts";
import { type UnitInterval, unitInterval } from "../core/journey-schedule.ts";
import type { Mail } from "../core/reply-text.ts";
import { type EmailAddress, type Instant, instant } from "../core/types.ts";
import { type Operator, verifyOperator } from "./access.ts";
import type { Config } from "./env.ts";
import { moderateWithJev } from "./moderation.ts";

export type OutboundMail = {
	readonly to: EmailAddress;
	readonly mail: Mail;
	readonly headers?: Readonly<Record<string, string>>;
};

/** What became of one mail: the provider took it, refuses the address, or failed for a reason named by its code alone. */
export type SendOutcome =
	| { readonly kind: "sent"; readonly messageId: string }
	| { readonly kind: "suppressed" }
	| { readonly kind: "failed"; readonly reason: string };

/** The effects the handlers need, so tests can replace the clock, randomness, the moderator, the mail sender, and the operator's sign-in. */
export type Ports = {
	readonly now: () => Instant;
	readonly uniform: () => UnitInterval;
	readonly token: () => string;
	readonly newId: () => string;
	readonly moderate: (text: string) => Promise<ModerationVerdict | null>;
	readonly send: (mail: OutboundMail) => Promise<SendOutcome>;
	readonly operator: (token: string | undefined) => Promise<Operator | null>;
};

/** The code the Email Sending binding throws for an address on its suppression list, after a hard bounce or a complaint. */
const RECIPIENT_SUPPRESSED = "E_RECIPIENT_SUPPRESSED";

/**
 * The binding throws Error objects with a string `code`.
 * A suppressed recipient is a decision about the address; everything else is a failure, named by the code or the error's name and never by a message that could carry an address.
 */
export function sendFailure(error: unknown): SendOutcome {
	const code =
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		typeof error.code === "string"
			? error.code
			: null;
	if (code === RECIPIENT_SUPPRESSED) {
		return { kind: "suppressed" };
	}
	return {
		kind: "failed",
		reason: code ?? (error instanceof Error ? error.name : typeof error),
	};
}

const UINT32_RANGE = 2 ** 32;
const TOKEN_BYTES = 32;
const HEX_RADIX = 16;
const HEX_WIDTH = 2;

export function now(): Instant {
	const at = instant(Date.now());
	if (at === null) {
		throw new Error("the clock returned an invalid instant");
	}
	return at;
}

export function uniform(): UnitInterval {
	const [word] = crypto.getRandomValues(new Uint32Array(1));
	const u = unitInterval((word ?? 0) / UINT32_RANGE);
	if (u === null) {
		throw new Error("the random source left the unit interval");
	}
	return u;
}

export function token(): string {
	return Array.from(
		crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)),
		(byte) => byte.toString(HEX_RADIX).padStart(HEX_WIDTH, "0"),
	).join("");
}

export function productionPorts(env: Env, config: Config): Ports {
	return {
		now,
		uniform,
		token,
		newId: () => crypto.randomUUID(),
		moderate: (text) => moderateWithJev(config, text),
		send: async ({ to, mail, headers }) => {
			try {
				const result = await env.EMAIL.send({
					from: { name: config.SERVICE_NAME, email: config.NOTICES_ADDRESS },
					to,
					subject: mail.subject,
					text: mail.text,
					...(headers === undefined ? {} : { headers }),
				});
				return { kind: "sent", messageId: result.messageId };
			} catch (error) {
				return sendFailure(error);
			}
		},
		operator: (accessToken) => verifyOperator(accessToken, config),
	};
}
