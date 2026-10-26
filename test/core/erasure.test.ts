import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
	BODY_RETENTION_MS,
	type ErasureFacts,
	eraseBody,
	keepsText,
} from "../../src/core/erasure.ts";
import {
	addMillis,
	instant,
	LETTER_STATUSES,
	type LetterStatus,
} from "../../src/core/types.ts";
import { must } from "../support/must.ts";

const SETTLED = must(instant(1_800_000_000_000));
const RETENTION_OVER = addMillis(SETTLED, BODY_RETENTION_MS);
const STILL_KEPT = addMillis(RETENTION_OVER, -1);

function settled(status: LetterStatus, over: Partial<ErasureFacts> = {}) {
	return { status, settledAt: SETTLED, openReports: 0, erased: false, ...over };
}

const facts = fc.record({
	status: fc.constantFrom<LetterStatus>(...LETTER_STATUSES),
	settledAt: fc
		.integer({ min: 0, max: 2_000_000_000_000 })
		.map((ms) => must(instant(ms))),
	openReports: fc.nat({ max: 3 }),
	erased: fc.boolean(),
});
const anInstant = fc
	.integer({ min: 0, max: 2_100_000_000_000 })
	.map((ms) => must(instant(ms)));

describe("erasing a letter's text", () => {
	it("keeps the text of a letter on its way or waiting for the model, and of no other", () => {
		expect(LETTER_STATUSES.filter(keepsText)).toEqual(["held", "traveling"]);
	});

	it("erases a settled, unreported letter at the end of the retention period and not before", () => {
		for (const status of ["delivered", "rejected", "lost"] as const) {
			expect(eraseBody(settled(status), STILL_KEPT)).toBe(false);
			expect(eraseBody(settled(status), RETENTION_OVER)).toBe(true);
		}
	});

	it("gives up a letter that was never confirmed after the same period", () => {
		for (const status of [
			"pending_verification",
			"pending_confirmation",
		] as const) {
			expect(eraseBody(settled(status), STILL_KEPT)).toBe(false);
			expect(eraseBody(settled(status), RETENTION_OVER)).toBe(true);
		}
	});

	it("keeps the text while a report on the letter is open", () => {
		expect(
			eraseBody(settled("delivered", { openReports: 1 }), RETENTION_OVER),
		).toBe(false);
		expect(
			eraseBody(settled("delivered", { openReports: 0 }), RETENTION_OVER),
		).toBe(true);
	});

	it("erases a letter once", () => {
		expect(
			eraseBody(settled("delivered", { erased: true }), RETENTION_OVER),
		).toBe(false);
	});

	it("never touches a letter on its way or waiting, whatever its age or reports", () => {
		fc.assert(
			fc.property(facts, anInstant, (f, now) => {
				fc.pre(keepsText(f.status));
				expect(eraseBody(f, now)).toBe(false);
			}),
		);
	});

	it("decides exactly by the four facts", () => {
		fc.assert(
			fc.property(facts, anInstant, (f, now) => {
				expect(eraseBody(f, now)).toBe(
					!f.erased &&
						!keepsText(f.status) &&
						f.openReports === 0 &&
						f.settledAt + BODY_RETENTION_MS <= now,
				);
			}),
		);
	});

	it("stays erasable at every later instant", () => {
		fc.assert(
			fc.property(facts, anInstant, fc.nat(), (f, now, later) => {
				fc.pre(eraseBody(f, now));
				expect(eraseBody(f, addMillis(now, later))).toBe(true);
			}),
		);
	});
});
