import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addMillis, instant, letterId, userId } from "../../src/core/types.ts";
import { must } from "../support/must.ts";

describe("instant", () => {
	it("accepts whole non-negative milliseconds within the safe range", () => {
		expect(instant(0)).toBe(0);
		expect(instant(1)).toBe(1);
		expect(instant(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
	});

	it.each([-1, 0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
		"rejects %s",
		(ms) => {
			expect(instant(ms)).toBeNull();
		},
	);

	it("accepts every safe non-negative integer and nothing fractional", () => {
		fc.assert(fc.property(fc.integer({ min: 0 }), (ms) => instant(ms) === ms));
		fc.assert(
			fc.property(
				fc.double({ noNaN: true, noInteger: true }),
				(x) => instant(x) === null,
			),
		);
	});

	it("adds milliseconds without changing the brand", () => {
		expect(addMillis(must(instant(10)), 5)).toBe(15);
		expect(addMillis(must(instant(10)), -5)).toBe(5);
	});
});

describe("identifiers", () => {
	it("trim their text and refuse blank text", () => {
		expect(userId(" user-1 ")).toBe("user-1");
		expect(letterId("\tletter-1\n")).toBe("letter-1");
		expect(userId("")).toBeNull();
		expect(userId("   ")).toBeNull();
		expect(letterId("")).toBeNull();
		expect(letterId(" \r\n ")).toBeNull();
	});

	it("keep every non-blank string, trimmed", () => {
		fc.assert(
			fc.property(fc.string(), (raw) => {
				const trimmed = raw.trim();
				const expected = trimmed.length === 0 ? null : trimmed;
				return userId(raw) === expected && letterId(raw) === expected;
			}),
		);
	});
});
