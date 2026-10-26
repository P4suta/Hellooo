import { DAY_MS, HOUR_MS } from "./duration.ts";
import { addMillis, type Brand, type Instant } from "./types.ts";

export const JOURNEY_MIN_MS = 6 * HOUR_MS;
export const JOURNEY_MAX_MS = 21 * DAY_MS;
export const JOURNEY_MEDIAN_MS = 3 * DAY_MS;
/** Standard deviation of the log duration; it puts roughly one letter in twenty past two weeks. */
const JOURNEY_SIGMA = 0.94;
const LOG_MEDIAN = Math.log(JOURNEY_MEDIAN_MS);
const BOX_MULLER_SCALE = -2;
const TAU = 2 * Math.PI;

/** A number in [0, 1), as a uniform random source yields. */
export type UnitInterval = Brand<number, "UnitInterval">;

export function unitInterval(x: number): UnitInterval | null {
	return Number.isFinite(x) && x >= 0 && x < 1
		? (Math.abs(x) as UnitInterval)
		: null;
}

/** The bound every journey obeys, whatever the draw: never shorter than the minimum, never longer than the maximum. */
export function clampJourney(duration: number): number {
	return Math.min(JOURNEY_MAX_MS, Math.max(JOURNEY_MIN_MS, duration));
}

/** A log-normal journey length in whole milliseconds, clamped to the journey bounds. */
export function journeyDuration(u1: UnitInterval, u2: UnitInterval): number {
	const deviate =
		Math.sqrt(BOX_MULLER_SCALE * Math.log(1 - u1)) * Math.cos(TAU * u2);
	return Math.round(
		clampJourney(Math.exp(LOG_MEDIAN + JOURNEY_SIGMA * deviate)),
	);
}

export function deliverAfter(
	now: Instant,
	u1: UnitInterval,
	u2: UnitInterval,
): Instant {
	return addMillis(now, journeyDuration(u1, u2));
}
