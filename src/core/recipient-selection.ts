import type { UnitInterval } from "./journey-schedule.ts";
import type { UserId, UserStatus } from "./types.ts";

export type Candidate = {
	readonly id: UserId;
	readonly status: UserStatus;
	readonly credits: number;
	readonly receivedFromSender: boolean;
};

/** Active strangers who hold a credit and never received a letter from this sender. */
export function eligibleRecipients(
	candidates: readonly Candidate[],
	senderId: UserId,
): Candidate[] {
	return candidates.filter(
		(candidate) =>
			candidate.status === "active" &&
			candidate.credits > 0 &&
			candidate.id !== senderId &&
			!candidate.receivedFromSender,
	);
}

/**
 * One eligible stranger chosen by the uniform, or null when nobody is eligible.
 * A product of a double below one and an integer length never rounds up to the length, so the index stays in range.
 */
export function selectRecipient(
	candidates: readonly Candidate[],
	senderId: UserId,
	u: UnitInterval,
): Candidate | null {
	const eligible = eligibleRecipients(candidates, senderId);
	return eligible[Math.floor(u * eligible.length)] ?? null;
}
