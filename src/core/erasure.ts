import { DAY_MS } from "./duration.ts";
import { addMillis, type Instant, type LetterStatus } from "./types.ts";

/** How long a letter's text stays after its journey ends or never begins: long enough for a late report, no longer. */
export const BODY_RETENTION_MS = 90 * DAY_MS;

/** What decides whether a letter's text may go. */
export type ErasureFacts = {
	readonly status: LetterStatus;
	/** When the journey ended or, for a letter that never went out, when it arrived. */
	readonly settledAt: Instant;
	readonly openReports: number;
	readonly erased: boolean;
};

/** A letter on its way, or waiting for the model, keeps its text whatever its age. */
export function keepsText(status: LetterStatus): boolean {
	return status === "held" || status === "traveling";
}

/** The text goes once the letter is neither on its way nor waiting, nobody's report on it is open, and the retention period has passed. */
export function eraseBody(facts: ErasureFacts, now: Instant): boolean {
	return (
		!facts.erased &&
		!keepsText(facts.status) &&
		facts.openReports === 0 &&
		addMillis(facts.settledAt, BODY_RETENTION_MS) <= now
	);
}
