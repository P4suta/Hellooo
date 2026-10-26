import type { UserId } from "./types.ts";

/** The model of receive credits that the database adapter must preserve: one per accepted letter, one spent per delivery. */
export type Ledger = {
	readonly credits: ReadonlyMap<UserId, number>;
	readonly accepted: number;
	readonly delivered: number;
};

export const emptyLedger: Ledger = {
	credits: new Map(),
	accepted: 0,
	delivered: 0,
};

export function creditsOf(ledger: Ledger, who: UserId): number {
	return ledger.credits.get(who) ?? 0;
}

export function recordAccepted(ledger: Ledger, senderId: UserId): Ledger {
	const credits = new Map(ledger.credits);
	credits.set(senderId, creditsOf(ledger, senderId) + 1);
	return {
		credits,
		accepted: ledger.accepted + 1,
		delivered: ledger.delivered,
	};
}

/** Null when the recipient holds no credit, so a delivery never overdraws. */
export function recordDelivered(
	ledger: Ledger,
	recipientId: UserId,
): Ledger | null {
	const held = creditsOf(ledger, recipientId);
	if (held <= 0) {
		return null;
	}
	const credits = new Map(ledger.credits);
	credits.set(recipientId, held - 1);
	return {
		credits,
		accepted: ledger.accepted,
		delivered: ledger.delivered + 1,
	};
}

/** Reverses a reserved delivery whose mail could not be sent: the credit returns and the delivery count falls. */
export function recordUndone(
	ledger: Ledger,
	recipientId: UserId,
): Ledger | null {
	if (ledger.delivered <= 0) {
		return null;
	}
	const credits = new Map(ledger.credits);
	credits.set(recipientId, creditsOf(ledger, recipientId) + 1);
	return {
		credits,
		accepted: ledger.accepted,
		delivered: ledger.delivered - 1,
	};
}

export function creditTotal(ledger: Ledger): number {
	let total = 0;
	for (const held of ledger.credits.values()) {
		total += held;
	}
	return total;
}

export function conserved(ledger: Ledger): boolean {
	return creditTotal(ledger) === ledger.accepted - ledger.delivered;
}
