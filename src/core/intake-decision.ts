import type { LetterText, LetterTextProblem } from "./letter-text.ts";
import type { DmarcResult, Instant, UserId, UserStatus } from "./types.ts";
import { rejectionsRemaining, weeklyCap } from "./weekly-cap.ts";

export type KnownSender = {
	readonly id: UserId;
	readonly status: UserStatus;
	readonly lastAcceptedAt: Instant | null;
	readonly rejectionsInLastDay: number;
};

export type IntakeInput = {
	/** Null when no user has this address. */
	readonly sender: KnownSender | null;
	readonly dmarc: DmarcResult;
	readonly now: Instant;
	readonly text: LetterText;
};

export type IgnoreReason =
	| "unauthenticated-unknown-sender"
	| "unauthenticated-sender-blocked"
	| "sender-inactive";

export type IntakeDecision =
	| { readonly kind: "ignore"; readonly reason: IgnoreReason }
	| { readonly kind: "register"; readonly storeLetter: boolean }
	| { readonly kind: "confirm" }
	| { readonly kind: "over-cap"; readonly nextAllowedAt: Instant }
	| { readonly kind: "rejections-exhausted" }
	| { readonly kind: "reject-text"; readonly problem: LetterTextProblem }
	| { readonly kind: "moderate" };

/**
 * Decides what one incoming mail leads to, before any moderation call.
 * Replies reach only authenticated senders, so an unauthenticated mail either asks for confirmation or ends in silence.
 */
export function decideIntake(input: IntakeInput): IntakeDecision {
	const { sender, dmarc, now, text } = input;
	const authenticated = dmarc === "pass";
	if (sender === null || sender.status === "pending") {
		return authenticated
			? { kind: "register", storeLetter: text.ok }
			: { kind: "ignore", reason: "unauthenticated-unknown-sender" };
	}
	if (sender.status !== "active") {
		return { kind: "ignore", reason: "sender-inactive" };
	}
	const cap = weeklyCap(sender.lastAcceptedAt, now);
	if (!authenticated) {
		return cap.allowed && text.ok
			? { kind: "confirm" }
			: { kind: "ignore", reason: "unauthenticated-sender-blocked" };
	}
	if (!cap.allowed) {
		return { kind: "over-cap", nextAllowedAt: cap.nextAllowedAt };
	}
	if (rejectionsRemaining(sender.rejectionsInLastDay) === 0) {
		return { kind: "rejections-exhausted" };
	}
	if (!text.ok) {
		return { kind: "reject-text", problem: text.problem };
	}
	return { kind: "moderate" };
}

export type ModerationVerdict = "deliver" | "reject";

/** What becomes of a stored letter: it goes out, it is refused, or it waits for the model to answer again later. */
export type AcceptanceDecision =
	| { readonly kind: "accept" }
	| { readonly kind: "reject-content" }
	| { readonly kind: "retry-later" };

/** The model's verdict decides; no verdict, because the model could not be asked, leaves the letter waiting for another attempt. */
export function decideAfterModeration(
	verdict: ModerationVerdict | null,
): AcceptanceDecision {
	switch (verdict) {
		case "deliver":
			return { kind: "accept" };
		case "reject":
			return { kind: "reject-content" };
		case null:
			return { kind: "retry-later" };
	}
}
