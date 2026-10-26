import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DAY_MS, HOUR_MS } from "../../src/core/duration.ts";
import {
	deliverAfter,
	JOURNEY_MAX_MS,
	JOURNEY_MEDIAN_MS,
	JOURNEY_MIN_MS,
	journeyDuration,
	unitInterval,
} from "../../src/core/journey-schedule.ts";
import { instant } from "../../src/core/types.ts";
import { must } from "../support/must.ts";

const unit = fc
	.double({ min: 0, max: 1, maxExcluded: true, noNaN: true })
	.map((x) => must(unitInterval(x)));
const now = must(instant(1_800_000_000_000));
const SAMPLES = 2001;
const LCG_MULTIPLIER = 1_664_525;
const LCG_INCREMENT = 1_013_904_223;
const LCG_MODULUS = 2 ** 32;

/** A small deterministic generator, so the distribution check never depends on the test runner's seed. */
function* uniforms(seed: number): Generator<number> {
	let state = seed;
	while (true) {
		state = (LCG_MULTIPLIER * state + LCG_INCREMENT) % LCG_MODULUS;
		yield state / LCG_MODULUS;
	}
}

describe("unitInterval", () => {
	it("admits [0, 1) only", () => {
		expect(unitInterval(0)).toBe(0);
		expect(unitInterval(0.5)).toBe(0.5);
		expect(unitInterval(1 - Number.EPSILON)).toBe(1 - Number.EPSILON);
		expect(unitInterval(1)).toBeNull();
		expect(unitInterval(-0.1)).toBeNull();
		expect(unitInterval(-0)).toBe(0);
		expect(unitInterval(Number.NaN)).toBeNull();
		expect(unitInterval(Number.POSITIVE_INFINITY)).toBeNull();
		expect(unitInterval(Number.NEGATIVE_INFINITY)).toBeNull();
	});
});

describe("journeyDuration", () => {
	it("stays within the journey bounds for every pair of uniforms", () => {
		fc.assert(
			fc.property(unit, unit, (u1, u2) => {
				const duration = journeyDuration(u1, u2);
				return (
					Number.isInteger(duration) &&
					duration >= JOURNEY_MIN_MS &&
					duration <= JOURNEY_MAX_MS
				);
			}),
		);
	});

	it("lands near the median when the normal deviate is zero", () => {
		const duration = journeyDuration(
			must(unitInterval(0.5)),
			must(unitInterval(0.25)),
		);
		expect(Math.abs(duration - JOURNEY_MEDIAN_MS)).toBeLessThan(HOUR_MS);
		expect(
			journeyDuration(must(unitInterval(0)), must(unitInterval(0.7))),
		).toBe(JOURNEY_MEDIAN_MS);
	});

	it("clamps the far tails to the bounds", () => {
		const extreme = must(unitInterval(1 - Number.EPSILON));
		expect(journeyDuration(extreme, must(unitInterval(0)))).toBe(
			JOURNEY_MAX_MS,
		);
		expect(journeyDuration(extreme, must(unitInterval(0.5)))).toBe(
			JOURNEY_MIN_MS,
		);
	});

	it("is deterministic", () => {
		fc.assert(
			fc.property(unit, unit, (u1, u2) => {
				const first = journeyDuration(u1, u2);
				const second = journeyDuration(u1, u2);
				return first === second;
			}),
		);
	});

	it("puts the sample median within a day of the design median", () => {
		const source = uniforms(42);
		const durations: number[] = [];
		for (let i = 0; i < SAMPLES; i += 1) {
			const u1 = must(unitInterval(source.next().value));
			const u2 = must(unitInterval(source.next().value));
			durations.push(journeyDuration(u1, u2));
		}
		durations.sort((a, b) => a - b);
		const median = durations[Math.floor(SAMPLES / 2)] ?? 0;
		expect(Math.abs(median - JOURNEY_MEDIAN_MS)).toBeLessThan(DAY_MS);
		expect(durations[0]).toBeGreaterThanOrEqual(JOURNEY_MIN_MS);
		expect(durations[SAMPLES - 1]).toBeLessThanOrEqual(JOURNEY_MAX_MS);
		const beyondTwoWeeks = durations.filter((d) => d > 14 * DAY_MS).length;
		expect(beyondTwoWeeks / SAMPLES).toBeGreaterThan(0.01);
		expect(beyondTwoWeeks / SAMPLES).toBeLessThan(0.15);
	});
});

describe("deliverAfter", () => {
	it("schedules after now by the journey duration", () => {
		fc.assert(
			fc.property(unit, unit, (u1, u2) => {
				const at = deliverAfter(now, u1, u2);
				return at - now === journeyDuration(u1, u2) && at > now;
			}),
		);
	});
});
