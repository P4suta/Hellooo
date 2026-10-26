declare const brand: unique symbol;

/** A nominal wrapper that keeps two structurally equal primitives apart. */
export type Brand<T, Name extends string> = T & { readonly [brand]: Name };

/** Milliseconds since the Unix epoch. */
export type Instant = Brand<number, "Instant">;
export type EmailAddress = Brand<string, "EmailAddress">;
export type UserId = Brand<string, "UserId">;
export type LetterId = Brand<string, "LetterId">;

export const DMARC_RESULTS = ["pass", "fail", "none"] as const;
export type DmarcResult = (typeof DMARC_RESULTS)[number];

export const USER_STATUSES = [
	"pending",
	"active",
	"unsubscribed",
	"suppressed",
	"banned",
] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const LETTER_STATUSES = [
	"pending_verification",
	"pending_confirmation",
	"rejected",
	"held",
	"traveling",
	"delivered",
	"lost",
] as const;
export type LetterStatus = (typeof LETTER_STATUSES)[number];

export function instant(ms: number): Instant | null {
	return Number.isSafeInteger(ms) && ms >= 0 ? (ms as Instant) : null;
}

/** Instant arithmetic stays within safe integers for any epoch offset a mail service meets. */
export function addMillis(at: Instant, ms: number): Instant {
	return (at + ms) as Instant;
}

function nonEmpty(raw: string): string | null {
	const trimmed = raw.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export function userId(raw: string): UserId | null {
	return nonEmpty(raw) as UserId | null;
}

export function letterId(raw: string): LetterId | null {
	return nonEmpty(raw) as LetterId | null;
}
