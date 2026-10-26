import {
	type AcceptanceDecision,
	decideAfterModeration,
} from "../core/intake-decision.ts";
import { deliverAfter } from "../core/journey-schedule.ts";
import { addMillis, type Instant } from "../core/types.ts";
import { LETTER_INTERVAL_MS, weeklyCap } from "../core/weekly-cap.ts";
import type { Ports } from "./ports.ts";
import {
	acceptLetter,
	dropOverCap,
	type Letter,
	lastAcceptedAt,
	settleLetter,
} from "./repository.ts";

/** The moderation value of a letter that waits for the model to answer. */
export const MODERATION_PENDING = "pending";

/** What became of a stored letter: the model's decision, or the loss of its sender's weekly slot to another letter that was accepted first. */
export type AdmissionOutcome =
	| AcceptanceDecision
	| { readonly kind: "over-cap"; readonly nextAllowedAt: Instant };

/** Asks the model about a stored letter and either starts its journey, refuses it, leaves it held until the model can be asked again, or drops it when its week is taken. */
export async function admitLetter(
	db: D1Database,
	ports: Ports,
	letter: Letter,
	now: Instant,
): Promise<AdmissionOutcome> {
	const verdict = await ports.moderate(letter.body);
	const decision = decideAfterModeration(verdict);
	switch (decision.kind) {
		case "accept": {
			const accepted = await acceptLetter(db, {
				letterId: letter.id,
				senderId: letter.senderId,
				deliverAfter: deliverAfter(now, ports.uniform(), ports.uniform()),
				moderation: verdict ?? MODERATION_PENDING,
				now,
			});
			if (accepted) {
				break;
			}
			const cap = weeklyCap(await lastAcceptedAt(db, letter.senderId), now);
			await dropOverCap(db, letter.id, letter.senderId, now);
			return {
				kind: "over-cap",
				nextAllowedAt: cap.allowed
					? addMillis(now, LETTER_INTERVAL_MS)
					: cap.nextAllowedAt,
			};
		}
		case "reject-content":
			await settleLetter(
				db,
				letter.id,
				letter.senderId,
				"rejected",
				verdict ?? MODERATION_PENDING,
				now,
			);
			break;
		case "retry-later":
			await settleLetter(
				db,
				letter.id,
				letter.senderId,
				"held",
				MODERATION_PENDING,
				now,
			);
			break;
	}
	return decision;
}
