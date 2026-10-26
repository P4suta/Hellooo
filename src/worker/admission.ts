import {
	type AcceptanceDecision,
	decideAfterModeration,
} from "../core/intake-decision.ts";
import { deliverAfter } from "../core/journey-schedule.ts";
import type { Instant } from "../core/types.ts";
import type { Ports } from "./ports.ts";
import { acceptLetter, type Letter, settleLetter } from "./repository.ts";

/** The moderation value of a letter that waits for the model to answer. */
export const MODERATION_PENDING = "pending";

/** Asks the model about a stored letter and either starts its journey, refuses it, or leaves it held until the model can be asked again. */
export async function admitLetter(
	db: D1Database,
	ports: Ports,
	letter: Letter,
	now: Instant,
): Promise<AcceptanceDecision> {
	const verdict = await ports.moderate(letter.body);
	const decision = decideAfterModeration(verdict);
	switch (decision.kind) {
		case "accept":
			await acceptLetter(db, {
				letterId: letter.id,
				senderId: letter.senderId,
				deliverAfter: deliverAfter(now, ports.uniform(), ports.uniform()),
				moderation: verdict ?? MODERATION_PENDING,
				now,
			});
			break;
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
