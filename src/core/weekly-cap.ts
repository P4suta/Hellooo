import { WEEK_MS } from "./duration.ts";
import { addMillis, type Instant } from "./types.ts";

export const LETTER_INTERVAL_MS = WEEK_MS;
export const DAILY_REJECTION_LIMIT = 3;
export const DAILY_CONFIRMATION_LIMIT = 3;

export type CapCheck =
	| { readonly allowed: true }
	| { readonly allowed: false; readonly nextAllowedAt: Instant };

/** One accepted letter per rolling week, counted from the last acceptance. */
export function weeklyCap(
	lastAcceptedAt: Instant | null,
	now: Instant,
): CapCheck {
	if (lastAcceptedAt === null) {
		return { allowed: true };
	}
	const nextAllowedAt = addMillis(lastAcceptedAt, LETTER_INTERVAL_MS);
	return now >= nextAllowedAt
		? { allowed: true }
		: { allowed: false, nextAllowedAt };
}

/** Moderation attempts left today, so a refused letter can be rewritten a few times without burning the service's budget. */
export function rejectionsRemaining(rejectionsInLastDay: number): number {
	return Math.max(0, DAILY_REJECTION_LIMIT - rejectionsInLastDay);
}

/** Confirmation mails left today for a registered address, so a stranger who writes in that name cannot flood it. */
export function confirmationsRemaining(confirmationsInLastDay: number): number {
	return Math.max(0, DAILY_CONFIRMATION_LIMIT - confirmationsInLastDay);
}
