import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { DAY_MS } from "../../src/core/duration.ts";
import {
	BODY_RETENTION_MS,
	type ErasureFacts,
	eraseBody,
} from "../../src/core/erasure.ts";
import {
	addMillis,
	type Instant,
	LETTER_STATUSES,
} from "../../src/core/types.ts";
import { runErasure } from "../../src/worker/erasure.ts";
import {
	closeReports,
	confirmLetter,
	findLetter,
	type Letter,
	reportDelivery,
	reportedLetters,
	reserveDelivery,
	settleLetter,
	storeLetter,
	type User,
} from "../../src/worker/repository.ts";
import { must } from "../support/must.ts";
import { useEmptyStorage } from "./d1.ts";
import {
	eventKinds,
	type FakePorts,
	fakePorts,
	seedActiveUser,
	seedHeldLetter,
	seedTravelingLetter,
	T0,
} from "./fakes.ts";

useEmptyStorage();

/** The first instant at which a letter settled at T0 loses its text. */
const RETENTION_OVER = addMillis(T0, BODY_RETENTION_MS);
const STILL_KEPT = addMillis(RETENTION_OVER, -1);

async function delivered(
	ports: FakePorts,
	writer: User,
	reader: User,
	body: string,
	sentAt: Instant,
): Promise<Letter> {
	const letter = await seedTravelingLetter(ports, writer, sentAt, body);
	expect(
		await reserveDelivery(env.DB, {
			letterId: letter.id,
			recipientId: reader.id,
			reportToken: `report-${letter.id}`,
			now: sentAt,
		}),
	).toBe(true);
	return letter;
}

async function bodyAndErasure(
	letter: Letter,
): Promise<{ body: string; erasedAt: Instant | null; status: string }> {
	const stored = must(await findLetter(env.DB, letter.id));
	return {
		body: stored.body,
		erasedAt: stored.erasedAt,
		status: stored.status,
	};
}

describe("erasing the text of settled letters", () => {
	it("erases a delivered letter at the end of the retention period after its delivery, and records it", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		const reader = await seedActiveUser(ports, "reader@example.com", 1);
		const letter = await delivered(ports, writer, reader, "a letter", T0);

		ports.clock = STILL_KEPT;
		expect(await runErasure(env, ports)).toEqual({ erased: 0 });
		expect(await bodyAndErasure(letter)).toEqual({
			body: "a letter",
			erasedAt: null,
			status: "delivered",
		});

		ports.clock = RETENTION_OVER;
		expect(await runErasure(env, ports)).toEqual({ erased: 1 });
		expect(await bodyAndErasure(letter)).toEqual({
			body: "",
			erasedAt: RETENTION_OVER,
			status: "delivered",
		});
		expect(await eventKinds()).toContain("letter_erased");

		expect(await runErasure(env, ports)).toEqual({ erased: 0 });
	});

	it("keeps a reported letter's text until the report is closed", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		const reader = await seedActiveUser(ports, "reader@example.com", 1);
		const letter = await delivered(ports, writer, reader, "reported", T0);
		await reportDelivery(env.DB, `report-${letter.id}`, addMillis(T0, DAY_MS));

		ports.clock = addMillis(RETENTION_OVER, DAY_MS);
		expect(await runErasure(env, ports)).toEqual({ erased: 0 });
		expect((await bodyAndErasure(letter)).body).toBe("reported");

		await closeReports(env.DB, letter.id, ports.clock);
		expect(await runErasure(env, ports)).toEqual({ erased: 1 });
		expect((await bodyAndErasure(letter)).body).toBe("");
	});

	it("shows a letter reported after its erasure without its text", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		const reader = await seedActiveUser(ports, "reader@example.com", 1);
		const letter = await delivered(ports, writer, reader, "late report", T0);
		ports.clock = RETENTION_OVER;
		await runErasure(env, ports);
		await reportDelivery(env.DB, `report-${letter.id}`, ports.clock);
		const [reported] = await reportedLetters(env.DB);
		expect(reported?.letter.body).toBe("");
		expect(reported?.letter.erasedAt).toBe(RETENTION_OVER);
		expect(reported?.reports).toBe(1);
	});

	it("keeps the text of letters on their way or waiting for the model, whatever their age", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		await seedTravelingLetter(
			ports,
			writer,
			addMillis(T0, 400 * DAY_MS),
			"on its way",
		);
		await seedHeldLetter(ports, writer, "waiting");
		ports.clock = addMillis(T0, 400 * DAY_MS);
		expect(await runErasure(env, ports)).toEqual({ erased: 0 });
	});

	it("erases a refused letter and a lost one from their arrival", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		const refused = await seedHeldLetter(ports, writer, "refused");
		await settleLetter(env.DB, refused.id, writer.id, "rejected", "reject", T0);
		const lost = await seedHeldLetter(ports, writer, "lost");
		await env.DB.prepare("UPDATE letters SET status = 'lost' WHERE id = ?")
			.bind(lost.id)
			.run();
		ports.clock = RETENTION_OVER;
		expect(await runErasure(env, ports)).toEqual({ erased: 2 });
		expect((await bodyAndErasure(refused)).status).toBe("rejected");
		expect((await bodyAndErasure(lost)).body).toBe("");
	});

	it("gives up a letter nobody confirmed: its text goes, it is lost, and its link stops working", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		const unconfirmed = await storeLetter(env.DB, {
			id: ports.newId(),
			senderId: writer.id,
			body: "unconfirmed",
			status: "pending_confirmation",
			confirmToken: "confirm-1",
			now: T0,
		});
		const unverified = await storeLetter(env.DB, {
			id: ports.newId(),
			senderId: writer.id,
			body: "unverified",
			status: "pending_verification",
			now: T0,
		});
		ports.clock = RETENTION_OVER;
		expect(await runErasure(env, ports)).toEqual({ erased: 2 });
		expect(await bodyAndErasure(unconfirmed)).toEqual({
			body: "",
			erasedAt: RETENTION_OVER,
			status: "lost",
		});
		expect((await bodyAndErasure(unverified)).status).toBe("lost");
		expect(await confirmLetter(env.DB, "confirm-1", ports.clock)).toBeNull();
	});

	it("agrees with the core decision for every status, age, and report state", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		const reader = await seedActiveUser(ports, "reader@example.com", 40);
		const cases: { letter: Letter; facts: ErasureFacts }[] = [];
		for (const status of LETTER_STATUSES) {
			for (const settledAt of [T0, addMillis(T0, 1)]) {
				for (const openReports of [0, 1]) {
					const body = `${status} ${settledAt} ${openReports}`;
					let letter: Letter;
					if (status === "delivered") {
						letter = await delivered(ports, writer, reader, body, settledAt);
					} else {
						letter = await storeLetter(env.DB, {
							id: ports.newId(),
							senderId: writer.id,
							body,
							status: "held",
							now: settledAt,
						});
						await env.DB.prepare("UPDATE letters SET status = ? WHERE id = ?")
							.bind(status, letter.id)
							.run();
					}
					if (openReports > 0) {
						await env.DB.prepare(
							"INSERT INTO events (kind, letter_id, created_at) VALUES ('letter_reported', ?, ?)",
						)
							.bind(letter.id, settledAt)
							.run();
					}
					cases.push({
						letter,
						facts: { status, settledAt, openReports, erased: false },
					});
				}
			}
		}
		ports.clock = RETENTION_OVER;
		const expected = cases.filter(({ facts }) =>
			eraseBody(facts, RETENTION_OVER),
		);
		expect(await runErasure(env, ports)).toEqual({ erased: expected.length });
		for (const { letter, facts } of cases) {
			expect(
				(await bodyAndErasure(letter)).erasedAt !== null,
				JSON.stringify(facts),
			).toBe(eraseBody(facts, RETENTION_OVER));
		}
	});
});
