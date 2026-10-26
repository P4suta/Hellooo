import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { messagesFor } from "../../src/core/messages.ts";
import { addMillis } from "../../src/core/types.ts";
import { DUE_LETTERS_PER_RUN, runDelivery } from "../../src/worker/delivery.ts";
import type { Ports } from "../../src/worker/ports.ts";
import {
	findLetter,
	findUserById,
	reserveDelivery,
} from "../../src/worker/repository.ts";
import { mailSubject } from "../support/copy.ts";
import { must } from "../support/must.ts";
import { useEmptyStorage } from "./d1.ts";
import {
	CONFIG,
	creditsOf,
	eventKinds,
	fakePorts,
	seedActiveUser,
	seedTravelingLetter,
	T0,
} from "./fakes.ts";

useEmptyStorage();

const due = addMillis(T0, -1);

describe("the delivery run", () => {
	it("hands a due letter to a stranger with a credit and spends it", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		const reader = await seedActiveUser(ports, "reader@example.com", 1);
		const letter = await seedTravelingLetter(ports, writer, due);
		const run = await runDelivery(env, ports);
		expect(run).toEqual({ due: 1, delivered: 1, waiting: 0, failed: 0 });
		expect(ports.sent).toHaveLength(1);
		expect(ports.sent[0]?.to).toBe(reader.email);
		expect(ports.sent[0]?.mail.subject).toBe(
			mailSubject(CONFIG.SERVICE_NAME, "en", (m) => m.delivery),
		);
		expect(ports.sent[0]?.mail.text.startsWith(`${letter.body}\n`)).toBe(true);
		expect(ports.sent[0]?.headers?.["List-Unsubscribe-Post"]).toBe(
			"List-Unsubscribe=One-Click",
		);
		expect(ports.sent[0]?.headers?.["List-Unsubscribe"]).toBe(
			`<${CONFIG.PUBLIC_BASE_URL}/stop/page-reader%40example.com>`,
		);
		expect(ports.sent[0]?.mail.text).toContain("/report/token-");
		expect(ports.sent[0]?.mail.text).toContain(
			"/you/page-reader%40example.com",
		);
		expect(await creditsOf(reader)).toBe(0);
		expect(must(await findLetter(env.DB, letter.id)).status).toBe("delivered");
		expect(await eventKinds()).toContain("letter_delivered");
	});

	it("writes the delivery in the reader's language", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		await seedActiveUser(ports, "reader@example.jp", 1, "ja");
		await seedTravelingLetter(ports, writer, due);
		await runDelivery(env, ports);
		expect(ports.sent[0]?.mail.subject).toBe(
			mailSubject(CONFIG.SERVICE_NAME, "ja", (m) => m.delivery),
		);
		expect(ports.sent[0]?.mail.text).toContain(messagesFor("ja").mail.you);
		expect(ports.sent[0]?.mail.text).toContain(
			messagesFor("ja").mail.delivery.footer(CONFIG.SERVICE_NAME),
		);
	});

	it("leaves a letter traveling while nobody eligible holds a credit", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com", 3);
		await seedActiveUser(ports, "broke@example.com");
		const letter = await seedTravelingLetter(ports, writer, due);
		expect(await runDelivery(env, ports)).toEqual({
			due: 1,
			delivered: 0,
			waiting: 1,
			failed: 0,
		});
		expect(ports.sent).toHaveLength(0);
		expect(must(await findLetter(env.DB, letter.id)).status).toBe("traveling");
		expect(await creditsOf(writer)).toBe(3);
	});

	it("never hands a letter back to its writer", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com", 5);
		await seedTravelingLetter(ports, writer, due);
		expect(await runDelivery(env, ports)).toEqual({
			due: 1,
			delivered: 0,
			waiting: 1,
			failed: 0,
		});
		expect(ports.sent).toHaveLength(0);
	});

	it("skips a reader who already received a letter from this writer", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		const reader = await seedActiveUser(ports, "reader@example.com", 2);
		const first = await seedTravelingLetter(ports, writer, due, "first");
		await reserveDelivery(env.DB, {
			letterId: first.id,
			recipientId: reader.id,
			reportToken: "report-first",
			now: T0,
		});
		const second = await seedTravelingLetter(ports, writer, due, "second");
		expect(await runDelivery(env, ports)).toEqual({
			due: 1,
			delivered: 0,
			waiting: 1,
			failed: 0,
		});
		expect(must(await findLetter(env.DB, second.id)).status).toBe("traveling");
		expect(await creditsOf(reader)).toBe(1);
	});

	it("spends one credit per letter, so a second letter waits for another reader", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		const other = await seedActiveUser(ports, "other@example.com");
		const reader = await seedActiveUser(ports, "reader@example.com", 1);
		await seedTravelingLetter(ports, writer, due, "from writer");
		await seedTravelingLetter(ports, other, due, "from other");
		expect(await runDelivery(env, ports)).toEqual({
			due: 2,
			delivered: 1,
			waiting: 1,
			failed: 0,
		});
		expect(ports.sent).toHaveLength(1);
		expect(ports.sent[0]?.to).toBe(reader.email);
		expect(await creditsOf(reader)).toBe(0);
	});

	it("does not touch a letter whose journey has not ended", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		await seedActiveUser(ports, "reader@example.com", 1);
		await seedTravelingLetter(ports, writer, addMillis(T0, 1));
		expect(await runDelivery(env, ports)).toEqual({
			due: 0,
			delivered: 0,
			waiting: 0,
			failed: 0,
		});
		expect(ports.sent).toHaveLength(0);
	});

	it("returns the credit and the journey when the mail cannot be sent", async () => {
		const ports = fakePorts();
		ports.failSending = true;
		const writer = await seedActiveUser(ports, "writer@example.com");
		const reader = await seedActiveUser(ports, "reader@example.com", 1);
		const letter = await seedTravelingLetter(ports, writer, due);
		expect(await runDelivery(env, ports)).toEqual({
			due: 1,
			delivered: 0,
			waiting: 0,
			failed: 1,
		});
		expect(await creditsOf(reader)).toBe(1);
		expect(must(await findLetter(env.DB, letter.id)).status).toBe("traveling");
		expect(await eventKinds()).toContain("delivery_undone");
		ports.failSending = false;
		expect(await runDelivery(env, ports)).toEqual({
			due: 1,
			delivered: 1,
			waiting: 0,
			failed: 0,
		});
	});

	it("returns the credit and the journey when sending throws, and the run goes on", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		const reader = await seedActiveUser(ports, "reader@example.com", 1);
		const letter = await seedTravelingLetter(ports, writer, due);
		const throwing: Ports = {
			...ports,
			send: async () => {
				throw new Error("E_TEST_THROWS");
			},
		};
		expect(await runDelivery(env, throwing)).toEqual({
			due: 1,
			delivered: 0,
			waiting: 0,
			failed: 1,
		});
		expect(await creditsOf(reader)).toBe(1);
		expect(must(await findLetter(env.DB, letter.id)).status).toBe("traveling");
		expect(await eventKinds()).toContain("delivery_undone");
	});

	it("stops letters to a reader whose address the provider refuses, and keeps the letter on its way", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		const gone = await seedActiveUser(ports, "gone@example.com", 1);
		ports.suppressed.add(gone.email);
		const letter = await seedTravelingLetter(ports, writer, due);
		expect(await runDelivery(env, ports)).toEqual({
			due: 1,
			delivered: 0,
			waiting: 0,
			failed: 1,
		});
		expect(ports.sent).toHaveLength(0);
		expect(must(await findUserById(env.DB, gone.id)).status).toBe("suppressed");
		expect(await creditsOf(gone)).toBe(1);
		expect(must(await findLetter(env.DB, letter.id)).status).toBe("traveling");
		expect(await eventKinds()).toEqual(
			expect.arrayContaining(["delivery_undone", "user_suppressed"]),
		);

		const reader = await seedActiveUser(ports, "reader@example.com", 1);
		expect(await runDelivery(env, ports)).toEqual({
			due: 1,
			delivered: 1,
			waiting: 0,
			failed: 0,
		});
		expect(ports.sent[0]?.to).toBe(reader.email);
	});

	it("takes at most one batch of due letters per run", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		for (let i = 0; i <= DUE_LETTERS_PER_RUN; i += 1) {
			await seedActiveUser(ports, `reader-${i}@example.com`, 1);
			await seedTravelingLetter(
				ports,
				writer,
				addMillis(due, -i),
				`letter ${i}`,
			);
		}
		const first = await runDelivery(env, ports);
		expect(first.due).toBe(DUE_LETTERS_PER_RUN);
		expect(first.delivered).toBe(DUE_LETTERS_PER_RUN);
		const second = await runDelivery(env, ports);
		expect(second).toEqual({ due: 1, delivered: 1, waiting: 0, failed: 0 });
		expect(new Set(ports.sent.map((mail) => mail.to)).size).toBe(
			DUE_LETTERS_PER_RUN + 1,
		);
	});
});
