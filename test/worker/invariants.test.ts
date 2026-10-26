import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
	conserved,
	emptyLedger,
	type Ledger,
	creditsOf as modelCredits,
	recordAccepted,
	recordDelivered,
	recordUndone,
} from "../../src/core/credit-ledger.ts";
import { DAY_MS } from "../../src/core/duration.ts";
import { addMillis, type UserId } from "../../src/core/types.ts";
import {
	acceptLetter,
	banWriter,
	completeDelivery,
	createPendingUser,
	eraseLetters,
	findUserById,
	type Letter,
	reserveDelivery,
	storeLetter,
	suppressUser,
	undoDelivery,
	unsubscribe,
	verifyUser,
} from "../../src/worker/repository.ts";
import { must } from "../support/must.ts";
import { migrationsOf } from "./d1.ts";
import { address, creditsOf, T0 } from "./fakes.ts";

const PEOPLE = ["ann", "bob", "cho", "dee"] as const;
type Person = (typeof PEOPLE)[number];

type Operation =
	| { readonly kind: "register"; readonly who: Person }
	| { readonly kind: "verify"; readonly who: Person }
	| { readonly kind: "accept"; readonly who: Person }
	| { readonly kind: "reserve"; readonly from: Person; readonly to: Person }
	| { readonly kind: "undo" }
	| { readonly kind: "complete" }
	| { readonly kind: "unsubscribe"; readonly who: Person }
	| { readonly kind: "ban"; readonly who: Person }
	| { readonly kind: "suppress"; readonly who: Person }
	| { readonly kind: "erase" };

const person = fc.constantFrom<Person>(...PEOPLE);
const operation: fc.Arbitrary<Operation> = fc.oneof(
	person.map((who) => ({ kind: "register" as const, who })),
	person.map((who) => ({ kind: "verify" as const, who })),
	person.map((who) => ({ kind: "accept" as const, who })),
	fc
		.tuple(person, person)
		.map(([from, to]) => ({ kind: "reserve" as const, from, to })),
	fc.constant({ kind: "undo" as const }),
	fc.constant({ kind: "complete" as const }),
	person.map((who) => ({ kind: "unsubscribe" as const, who })),
	person.map((who) => ({ kind: "ban" as const, who })),
	person.map((who) => ({ kind: "suppress" as const, who })),
	fc.constant({ kind: "erase" as const }),
);

type World = {
	readonly ids: Map<Person, UserId>;
	readonly letters: Map<Person, Letter[]>;
	readonly reservations: { letter: Letter; recipient: UserId }[];
	ledger: Ledger;
	tokens: number;
};

async function totals(): Promise<{
	credits: number;
	accepted: number;
	delivered: number;
}> {
	const credits = must(
		await env.DB.prepare(
			"SELECT COALESCE(SUM(credits), 0) AS n FROM users",
		).first<{ n: number }>(),
	).n;
	const accepted = must(
		await env.DB.prepare(
			"SELECT COUNT(*) AS n FROM letters WHERE accepted_at IS NOT NULL",
		).first<{ n: number }>(),
	).n;
	const delivered = must(
		await env.DB.prepare("SELECT COUNT(*) AS n FROM deliveries").first<{
			n: number;
		}>(),
	).n;
	return { credits, accepted, delivered };
}

async function apply(world: World, op: Operation, now: number): Promise<void> {
	switch (op.kind) {
		case "register": {
			if (world.ids.has(op.who)) {
				return;
			}
			world.tokens += 1;
			const user = await createPendingUser(env.DB, {
				id: `user-${op.who}`,
				email: address(`${op.who}@example.com`),
				verifyToken: `verify-${op.who}`,
				pageKey: `page-${op.who}`,
				locale: "en",
				now: addMillis(T0, now),
			});
			world.ids.set(op.who, user.id);
			world.letters.set(op.who, []);
			return;
		}
		case "verify":
			await verifyUser(env.DB, `verify-${op.who}`, addMillis(T0, now));
			return;
		case "accept": {
			const id = world.ids.get(op.who);
			if (id === undefined) {
				return;
			}
			const user = must(await findUserById(env.DB, id));
			if (user.status !== "active") {
				return;
			}
			world.tokens += 1;
			const letter = await storeLetter(env.DB, {
				id: `letter-${world.tokens}`,
				senderId: id,
				body: `letter ${world.tokens}`,
				status: "held",
				now: addMillis(T0, now),
			});
			await acceptLetter(env.DB, {
				letterId: letter.id,
				senderId: id,
				deliverAfter: addMillis(T0, now + DAY_MS),
				moderation: "deliver",
				now: addMillis(T0, now),
			});
			world.letters.get(op.who)?.push(letter);
			world.ledger = recordAccepted(world.ledger, id);
			return;
		}
		case "reserve": {
			const senderLetters = world.letters.get(op.from) ?? [];
			const letter = senderLetters.find(
				(l) => !world.reservations.some((r) => r.letter.id === l.id),
			);
			const recipient = world.ids.get(op.to);
			if (letter === undefined || recipient === undefined) {
				return;
			}
			const recipientUser = must(await findUserById(env.DB, recipient));
			world.tokens += 1;
			const reserved = await reserveDelivery(env.DB, {
				letterId: letter.id,
				recipientId: recipient,
				reportToken: `report-${world.tokens}`,
				now: addMillis(T0, now),
			});
			const modelAllows =
				recipientUser.status === "active" &&
				modelCredits(world.ledger, recipient) > 0;
			expect(reserved).toBe(modelAllows);
			if (reserved) {
				world.reservations.push({ letter, recipient });
				world.ledger = must(recordDelivered(world.ledger, recipient));
			}
			return;
		}
		case "undo": {
			const reservation = world.reservations.pop();
			if (reservation === undefined) {
				return;
			}
			await undoDelivery(
				env.DB,
				reservation.letter.id,
				reservation.recipient,
				addMillis(T0, now),
			);
			world.ledger = must(recordUndone(world.ledger, reservation.recipient));
			return;
		}
		case "complete": {
			const reservation = world.reservations.at(-1);
			if (reservation === undefined) {
				return;
			}
			await completeDelivery(
				env.DB,
				reservation.letter.id,
				reservation.recipient,
				`provider-${world.tokens}`,
				addMillis(T0, now),
			);
			return;
		}
		case "unsubscribe":
			await unsubscribe(env.DB, `page-${op.who}`, addMillis(T0, now));
			return;
		case "suppress": {
			const id = world.ids.get(op.who);
			if (id !== undefined) {
				await suppressUser(env.DB, id, addMillis(T0, now));
			}
			return;
		}
		case "erase":
			// Everything settled so far loses its text; credits and deliveries stay.
			await eraseLetters(env.DB, {
				settledBefore: addMillis(T0, now),
				now: addMillis(T0, now),
			});
			return;
		case "ban": {
			const id = world.ids.get(op.who);
			if (id === undefined) {
				return;
			}
			await banWriter(env.DB, id, addMillis(T0, now));
			const letters = world.letters.get(op.who) ?? [];
			world.letters.set(
				op.who,
				letters.filter((l) =>
					world.reservations.some((r) => r.letter.id === l.id),
				),
			);
			return;
		}
	}
}

describe("the database agrees with the credit ledger", () => {
	it("keeps the credit law and every balance through any sequence of operations", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.array(operation, { maxLength: 24 }),
				async (operations) => {
					await reset();
					await applyD1Migrations(env.DB, migrationsOf(env));
					const world: World = {
						ids: new Map(),
						letters: new Map(),
						reservations: [],
						ledger: emptyLedger,
						tokens: 0,
					};
					let now = 0;
					for (const op of operations) {
						now += 1;
						await apply(world, op, now);
						const sums = await totals();
						expect(sums.credits).toBe(sums.accepted - sums.delivered);
						expect(conserved(world.ledger)).toBe(true);
						for (const [person, id] of world.ids) {
							const user = must(await findUserById(env.DB, id));
							expect(user.credits, `${person} after ${op.kind}`).toBe(
								modelCredits(world.ledger, id),
							);
							expect(await creditsOf(user)).toBeGreaterThanOrEqual(0);
						}
					}
				},
			),
			{ numRuns: 25 },
		);
	});
});
