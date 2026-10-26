import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { findLetter, findUserById } from "../../src/worker/repository.ts";
import {
	HELD_LETTERS_PER_RUN,
	retryModeration,
} from "../../src/worker/retry.ts";
import { mailSubject } from "../support/copy.ts";
import { must } from "../support/must.ts";
import { useEmptyStorage } from "./d1.ts";
import {
	CONFIG,
	creditsOf,
	eventKinds,
	fakePorts,
	seedActiveUser,
	seedHeldLetter,
} from "./fakes.ts";

useEmptyStorage();

describe("asking the model again", () => {
	it("starts a waiting letter on its way without another mail, and credits the writer", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		const held = await seedHeldLetter(ports, writer);
		expect(await retryModeration(env, ports)).toEqual({
			held: 1,
			accepted: 1,
			rejected: 0,
			overCap: 0,
			waiting: 0,
		});
		expect(must(await findLetter(env.DB, held.id)).status).toBe("traveling");
		expect(await creditsOf(writer)).toBe(1);
		expect(ports.sent).toHaveLength(0);
		expect(await eventKinds()).toContain("letter_accepted");
	});

	it("refuses a waiting letter and tells the writer in their language", async () => {
		const ports = fakePorts({ verdict: "reject" });
		const writer = await seedActiveUser(ports, "kakite@example.jp", 0, "ja");
		const held = await seedHeldLetter(ports, writer);
		expect(await retryModeration(env, ports)).toEqual({
			held: 1,
			accepted: 0,
			rejected: 1,
			overCap: 0,
			waiting: 0,
		});
		expect(must(await findLetter(env.DB, held.id)).status).toBe("rejected");
		expect(await creditsOf(writer)).toBe(0);
		expect(ports.sent).toHaveLength(1);
		expect(ports.sent[0]?.to).toBe(writer.email);
		expect(ports.sent[0]?.mail.subject).toBe(
			mailSubject(CONFIG.SERVICE_NAME, "ja", (m) => m.cannotTravel),
		);
	});

	it("stops letters to a writer whose address the provider refuses when the refusal cannot reach them", async () => {
		const ports = fakePorts({ verdict: "reject" });
		const writer = await seedActiveUser(ports, "writer@example.com");
		ports.suppressed.add(writer.email);
		const held = await seedHeldLetter(ports, writer);
		expect(await retryModeration(env, ports)).toEqual({
			held: 1,
			accepted: 0,
			rejected: 1,
			overCap: 0,
			waiting: 0,
		});
		expect(must(await findLetter(env.DB, held.id)).status).toBe("rejected");
		expect(must(await findUserById(env.DB, writer.id)).status).toBe(
			"suppressed",
		);
		expect(ports.sent).toHaveLength(0);
		expect(await eventKinds()).toContain("user_suppressed");
	});

	it("drops a waiting letter whose writer's week is already taken, and tells them when to write again", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		await seedHeldLetter(ports, writer, "first");
		await seedHeldLetter(ports, writer, "second");
		expect(await retryModeration(env, ports)).toEqual({
			held: 2,
			accepted: 1,
			rejected: 0,
			overCap: 1,
			waiting: 0,
		});
		expect(await creditsOf(writer)).toBe(1);
		expect(ports.sent).toHaveLength(1);
		expect(ports.sent[0]?.to).toBe(writer.email);
		expect(ports.sent[0]?.mail.subject).toBe(
			mailSubject(CONFIG.SERVICE_NAME, "en", (m) => m.overCap),
		);
	});

	it("leaves a letter waiting while the model still cannot be asked", async () => {
		const ports = fakePorts({ verdict: null });
		const writer = await seedActiveUser(ports, "writer@example.com");
		const held = await seedHeldLetter(ports, writer);
		expect(await retryModeration(env, ports)).toEqual({
			held: 1,
			accepted: 0,
			rejected: 0,
			overCap: 0,
			waiting: 1,
		});
		expect(must(await findLetter(env.DB, held.id)).status).toBe("held");
		expect(ports.sent).toHaveLength(0);
	});

	it("takes at most one batch per run, oldest first", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		for (let i = 0; i <= HELD_LETTERS_PER_RUN; i += 1) {
			await seedHeldLetter(ports, writer, `letter ${i}`);
		}
		expect((await retryModeration(env, ports)).held).toBe(HELD_LETTERS_PER_RUN);
		expect((await retryModeration(env, ports)).held).toBe(1);
		// One letter took the writer's week, so the others were dropped before the model was asked.
		expect(ports.moderated).toHaveLength(1);
	});

	it("does nothing without a waiting letter", async () => {
		const ports = fakePorts();
		expect(await retryModeration(env, ports)).toEqual({
			held: 0,
			accepted: 0,
			rejected: 0,
			overCap: 0,
			waiting: 0,
		});
	});
});
