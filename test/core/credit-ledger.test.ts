import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
	conserved,
	creditsOf,
	creditTotal,
	emptyLedger,
	type Ledger,
	recordAccepted,
	recordDelivered,
	recordUndone,
} from "../../src/core/credit-ledger.ts";
import { type UserId, userId } from "../../src/core/types.ts";
import { must } from "../support/must.ts";

const id = (raw: string): UserId => must(userId(raw));
const someone = fc.integer({ min: 1, max: 4 }).map((n) => id(`user-${n}`));
type Kind = "accepted" | "delivered" | "undone";
type Operation = { readonly kind: Kind; readonly who: UserId };
const exchange: fc.Arbitrary<Operation> = fc.oneof(
	someone.map((who) => ({ kind: "accepted" as const, who })),
	someone.map((who) => ({ kind: "delivered" as const, who })),
);
const operation: fc.Arbitrary<Operation> = fc.oneof(
	exchange,
	someone.map((who) => ({ kind: "undone" as const, who })),
);

function step(ledger: Ledger, operation: Operation): Ledger {
	switch (operation.kind) {
		case "accepted":
			return recordAccepted(ledger, operation.who);
		case "delivered":
			return recordDelivered(ledger, operation.who) ?? ledger;
		case "undone":
			return recordUndone(ledger, operation.who) ?? ledger;
	}
}

function replay(ledger: Ledger, operations: readonly Operation[]): Ledger {
	let state = ledger;
	for (const operation of operations) {
		state = step(state, operation);
	}
	return state;
}

describe("credit ledger", () => {
	it("starts empty and conserved", () => {
		expect(creditTotal(emptyLedger)).toBe(0);
		expect(conserved(emptyLedger)).toBe(true);
		expect(creditsOf(emptyLedger, id("nobody"))).toBe(0);
	});

	it("detects a ledger whose credits drifted from its counts", () => {
		const skewed: Ledger = {
			credits: new Map([[id("a"), 2]]),
			accepted: 1,
			delivered: 0,
		};
		expect(conserved(skewed)).toBe(false);
		expect(
			conserved({
				credits: new Map([[id("a"), 1]]),
				accepted: 3,
				delivered: 2,
			}),
		).toBe(true);
		expect(conserved({ credits: new Map(), accepted: 3, delivered: 3 })).toBe(
			true,
		);
	});

	it("grants one credit per accepted letter", () => {
		const ledger = recordAccepted(emptyLedger, id("a"));
		expect(creditsOf(ledger, id("a"))).toBe(1);
		expect(ledger.accepted).toBe(1);
		expect(ledger.delivered).toBe(0);
		expect(creditsOf(recordAccepted(ledger, id("a")), id("a"))).toBe(2);
	});

	it("refuses a delivery to someone without a credit", () => {
		expect(recordDelivered(emptyLedger, id("a"))).toBeNull();
		const funded = recordAccepted(emptyLedger, id("a"));
		expect(recordDelivered(funded, id("b"))).toBeNull();
	});

	it("spends one credit per delivery", () => {
		const ledger = must(
			recordDelivered(recordAccepted(emptyLedger, id("a")), id("a")),
		);
		expect(creditsOf(ledger, id("a"))).toBe(0);
		expect(ledger.delivered).toBe(1);
		expect(recordDelivered(ledger, id("a"))).toBeNull();
	});

	it("returns the credit when a reserved delivery is undone, and refuses to undo nothing", () => {
		const spent = must(
			recordDelivered(recordAccepted(emptyLedger, id("a")), id("a")),
		);
		const undone = must(recordUndone(spent, id("a")));
		expect(creditsOf(undone, id("a"))).toBe(1);
		expect(undone.accepted).toBe(1);
		expect(undone.delivered).toBe(0);
		expect(recordUndone(undone, id("a"))).toBeNull();
		expect(recordUndone(emptyLedger, id("a"))).toBeNull();
	});

	it("leaves the input ledger untouched", () => {
		const before = recordAccepted(emptyLedger, id("a"));
		const snapshot = JSON.stringify([...before.credits], null, 0);
		recordAccepted(before, id("b"));
		recordDelivered(before, id("a"));
		recordUndone(before, id("a"));
		expect(JSON.stringify([...before.credits], null, 0)).toBe(snapshot);
		expect(before.accepted).toBe(1);
		expect(before.delivered).toBe(0);
	});

	it("keeps the total of credits equal to accepted minus delivered letters", () => {
		fc.assert(
			fc.property(fc.array(operation), (operations) => {
				const ledger = replay(emptyLedger, operations);
				return (
					conserved(ledger) &&
					creditTotal(ledger) === ledger.accepted - ledger.delivered
				);
			}),
		);
	});

	it("never lets a credit or a count go negative", () => {
		fc.assert(
			fc.property(fc.array(operation), someone, (operations, who) => {
				const ledger = replay(emptyLedger, operations);
				return (
					creditsOf(ledger, who) >= 0 &&
					ledger.accepted >= 0 &&
					ledger.delivered >= 0
				);
			}),
		);
	});

	it("changes only the named person's credits", () => {
		fc.assert(
			fc.property(
				fc.array(operation),
				operation,
				someone,
				(history, next, other) => {
					fc.pre(other !== next.who);
					const before = replay(emptyLedger, history);
					const after = replay(before, [next]);
					return creditsOf(after, other) === creditsOf(before, other);
				},
			),
		);
	});

	it("gives each person exactly their accepted minus delivered count", () => {
		fc.assert(
			fc.property(fc.array(exchange), someone, (operations, who) => {
				let expected = 0;
				for (const operation of operations) {
					if (operation.who !== who) {
						continue;
					}
					if (operation.kind === "accepted") {
						expected += 1;
					} else if (expected > 0) {
						expected -= 1;
					}
				}
				return creditsOf(replay(emptyLedger, operations), who) === expected;
			}),
		);
	});
});
