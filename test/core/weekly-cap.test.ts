import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { WEEK_MS } from "../../src/core/duration.ts";
import { instant } from "../../src/core/types.ts";
import {
	confirmationsRemaining,
	DAILY_CONFIRMATION_LIMIT,
	DAILY_REJECTION_LIMIT,
	LETTER_INTERVAL_MS,
	rejectionsRemaining,
	weeklyCap,
} from "../../src/core/weekly-cap.ts";
import { must } from "../support/must.ts";

const NOW_MS = 1_800_000_000_000;
const now = must(instant(NOW_MS));

describe("weeklyCap", () => {
	it("measures one week", () => {
		expect(LETTER_INTERVAL_MS).toBe(WEEK_MS);
	});

	it("allows a sender who never had a letter accepted", () => {
		expect(weeklyCap(null, now)).toEqual({ allowed: true });
		expect(weeklyCap(null, must(instant(0)))).toEqual({ allowed: true });
	});

	it("allows a sender exactly one week after the last acceptance", () => {
		expect(weeklyCap(must(instant(NOW_MS - WEEK_MS)), now)).toEqual({
			allowed: true,
		});
	});

	it("refuses a sender inside the week and names the next allowed time", () => {
		const last = must(instant(NOW_MS - WEEK_MS + 1));
		expect(weeklyCap(last, now)).toEqual({
			allowed: false,
			nextAllowedAt: last + WEEK_MS,
		});
		expect(weeklyCap(now, now)).toEqual({
			allowed: false,
			nextAllowedAt: NOW_MS + WEEK_MS,
		});
	});

	it("refuses a letter dated in the future as well", () => {
		const future = must(instant(NOW_MS + 1));
		expect(weeklyCap(future, now)).toEqual({
			allowed: false,
			nextAllowedAt: NOW_MS + 1 + WEEK_MS,
		});
	});

	it("allows exactly when a week has passed", () => {
		fc.assert(
			fc.property(fc.integer({ min: 0, max: 2 * WEEK_MS }), (ageMs) => {
				const last = must(instant(NOW_MS - ageMs));
				const check = weeklyCap(last, now);
				return check.allowed
					? ageMs >= WEEK_MS
					: ageMs < WEEK_MS && check.nextAllowedAt === last + WEEK_MS;
			}),
		);
	});
});

describe("rejectionsRemaining", () => {
	it("counts down from the daily limit to zero and never below", () => {
		expect(rejectionsRemaining(0)).toBe(DAILY_REJECTION_LIMIT);
		expect(rejectionsRemaining(1)).toBe(DAILY_REJECTION_LIMIT - 1);
		expect(rejectionsRemaining(DAILY_REJECTION_LIMIT)).toBe(0);
		expect(rejectionsRemaining(DAILY_REJECTION_LIMIT + 5)).toBe(0);
	});

	it("never goes negative and never exceeds the limit", () => {
		fc.assert(
			fc.property(fc.integer({ min: 0 }), (n) => {
				const remaining = rejectionsRemaining(n);
				return remaining >= 0 && remaining <= DAILY_REJECTION_LIMIT;
			}),
		);
	});
});

describe("confirmationsRemaining", () => {
	it("counts down from the daily limit to zero and never below", () => {
		expect(confirmationsRemaining(0)).toBe(DAILY_CONFIRMATION_LIMIT);
		expect(confirmationsRemaining(1)).toBe(DAILY_CONFIRMATION_LIMIT - 1);
		expect(confirmationsRemaining(DAILY_CONFIRMATION_LIMIT)).toBe(0);
		expect(confirmationsRemaining(DAILY_CONFIRMATION_LIMIT + 5)).toBe(0);
	});

	it("never goes negative and never exceeds the limit", () => {
		fc.assert(
			fc.property(fc.integer({ min: 0 }), (n) => {
				const remaining = confirmationsRemaining(n);
				return remaining >= 0 && remaining <= DAILY_CONFIRMATION_LIMIT;
			}),
		);
	});
});
