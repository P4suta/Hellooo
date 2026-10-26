import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { unitInterval } from "../../src/core/journey-schedule.ts";
import {
	type Candidate,
	eligibleRecipients,
	selectRecipient,
} from "../../src/core/recipient-selection.ts";
import { USER_STATUSES, type UserId, userId } from "../../src/core/types.ts";
import { must } from "../support/must.ts";

const id = (raw: string): UserId => must(userId(raw));

const candidate = fc.record<Candidate>({
	id: fc.integer({ min: 1, max: 6 }).map((n) => id(`user-${n}`)),
	status: fc.constantFrom(...USER_STATUSES),
	credits: fc.integer({ min: 0, max: 3 }),
	receivedFromSender: fc.boolean(),
});
const unit = fc
	.double({ min: 0, max: 1, maxExcluded: true, noNaN: true })
	.map((x) => must(unitInterval(x)));
const sender = fc.integer({ min: 1, max: 6 }).map((n) => id(`user-${n}`));

const active = (raw: string, credits = 1): Candidate => ({
	id: id(raw),
	status: "active",
	credits,
	receivedFromSender: false,
});

describe("eligibleRecipients", () => {
	it("keeps active holders of a credit who are not the sender and never heard from them", () => {
		const candidates: Candidate[] = [
			active("sender"),
			active("broke", 0),
			{ ...active("quiet"), status: "unsubscribed" },
			{ ...active("gone"), status: "suppressed" },
			{ ...active("banned"), status: "banned" },
			{ ...active("waiting"), status: "pending" },
			{ ...active("repeat"), receivedFromSender: true },
			active("fresh"),
			active("rich", 3),
		];
		expect(
			eligibleRecipients(candidates, id("sender")).map((c) => c.id),
		).toEqual(["fresh", "rich"]);
	});

	it("preserves the candidates' order", () => {
		fc.assert(
			fc.property(fc.array(candidate), sender, (candidates, senderId) => {
				const eligible = eligibleRecipients(candidates, senderId);
				const positions = eligible.map((c) => candidates.indexOf(c));
				return positions.every(
					(p, i) => i === 0 || p > (positions[i - 1] ?? -1),
				);
			}),
		);
	});
});

describe("selectRecipient", () => {
	it("returns null exactly when nobody is eligible, and otherwise an eligible stranger", () => {
		fc.assert(
			fc.property(
				fc.array(candidate),
				sender,
				unit,
				(candidates, senderId, u) => {
					const eligible = eligibleRecipients(candidates, senderId);
					const chosen = selectRecipient(candidates, senderId, u);
					if (eligible.length === 0) {
						return chosen === null;
					}
					return (
						chosen !== null &&
						chosen.id !== senderId &&
						chosen.status === "active" &&
						chosen.credits > 0 &&
						!chosen.receivedFromSender &&
						eligible.includes(chosen)
					);
				},
			),
		);
	});

	it("walks the eligible list with the uniform", () => {
		const candidates = [active("a"), active("b"), active("c")];
		expect(
			selectRecipient(candidates, id("z"), must(unitInterval(0)))?.id,
		).toBe("a");
		expect(
			selectRecipient(candidates, id("z"), must(unitInterval(0.34)))?.id,
		).toBe("b");
		expect(
			selectRecipient(candidates, id("z"), must(unitInterval(0.999)))?.id,
		).toBe("c");
	});

	it("can reach every eligible candidate", () => {
		fc.assert(
			fc.property(
				fc.array(candidate, { minLength: 1 }),
				sender,
				(candidates, senderId) => {
					const eligible = eligibleRecipients(candidates, senderId);
					return eligible.every((wanted, index) => {
						const u = must(unitInterval((index + 0.5) / eligible.length));
						return selectRecipient(candidates, senderId, u) === wanted;
					});
				},
			),
		);
	});

	it("picks the last candidate for the largest uniform below one", () => {
		const largest = must(unitInterval(1 - Number.EPSILON / 2));
		fc.assert(
			fc.property(fc.integer({ min: 1, max: 500 }), (count) => {
				const candidates = Array.from({ length: count }, (_, i) =>
					active(`c${i}`),
				);
				return (
					selectRecipient(candidates, id("z"), largest) ===
					candidates[count - 1]
				);
			}),
		);
	});

	it("never picks the sender even when the sender is otherwise eligible", () => {
		const candidates = [active("me"), active("you")];
		fc.assert(
			fc.property(
				unit,
				(u) => selectRecipient(candidates, id("me"), u)?.id === "you",
			),
		);
	});
});
