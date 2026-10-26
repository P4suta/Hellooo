import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
	JOURNEY_MAX_MS,
	JOURNEY_MIN_MS,
} from "../../src/core/journey-schedule.ts";
import { admitLetter, MODERATION_PENDING } from "../../src/worker/admission.ts";
import { findLetter, storeLetter } from "../../src/worker/repository.ts";
import { must } from "../support/must.ts";
import { useEmptyStorage } from "./d1.ts";
import {
	creditsOf,
	eventKinds,
	fakePorts,
	seedActiveUser,
	T0,
} from "./fakes.ts";

useEmptyStorage();

describe("admitting a stored letter", () => {
	it("starts the journey on deliver, within the journey bounds, and credits the writer", async () => {
		const ports = fakePorts({ uniform: 0.5 });
		const writer = await seedActiveUser(ports, "writer@example.com");
		const letter = await storeLetter(env.DB, {
			id: "letter-1",
			senderId: writer.id,
			body: "Hellooo?",
			status: "held",
			now: T0,
		});
		const outcome = await admitLetter(env.DB, ports, letter, T0);
		expect(outcome).toEqual({ kind: "accept" });
		const stored = must(await findLetter(env.DB, letter.id));
		expect(stored.status).toBe("traveling");
		expect(stored.acceptedAt).toBe(T0);
		const deliverAfter = must(stored.deliverAfter);
		expect(deliverAfter - T0).toBeGreaterThanOrEqual(JOURNEY_MIN_MS);
		expect(deliverAfter - T0).toBeLessThanOrEqual(JOURNEY_MAX_MS);
		expect(await creditsOf(writer)).toBe(1);
		expect(ports.moderated).toEqual(["Hellooo?"]);
		expect(await eventKinds()).toEqual(["user_verified", "letter_accepted"]);
		const row = await env.DB.prepare(
			"SELECT moderation, confirm_token FROM letters WHERE id = ?",
		)
			.bind(letter.id)
			.first<{ moderation: string; confirm_token: string | null }>();
		expect(row).toEqual({ moderation: "deliver", confirm_token: null });
	});

	it.each([
		["reject", "rejected", "reject-content", "letter_rejected", "reject"],
		[null, "held", "retry-later", "letter_held", MODERATION_PENDING],
	] as const)(
		"settles the letter on the verdict %s without a credit",
		async (verdict, status, kind, event, moderation) => {
			const ports = fakePorts({ verdict });
			const writer = await seedActiveUser(ports, "writer@example.com");
			const letter = await storeLetter(env.DB, {
				id: "letter-1",
				senderId: writer.id,
				body: "Hellooo?",
				status: "pending_confirmation",
				confirmToken: "confirm-1",
				now: T0,
			});
			expect(await admitLetter(env.DB, ports, letter, T0)).toEqual({ kind });
			const stored = must(await findLetter(env.DB, letter.id));
			expect(stored.status).toBe(status);
			expect(stored.acceptedAt).toBeNull();
			expect(stored.deliverAfter).toBeNull();
			expect(await creditsOf(writer)).toBe(0);
			expect(await eventKinds()).toContain(event);
			const row = await env.DB.prepare(
				"SELECT moderation, confirm_token FROM letters WHERE id = ?",
			)
				.bind(letter.id)
				.first<{ moderation: string; confirm_token: string | null }>();
			expect(row).toEqual({ moderation, confirm_token: null });
		},
	);

	it("asks again later about a letter the model could not be asked about, and then decides", async () => {
		const ports = fakePorts({ verdict: null });
		const writer = await seedActiveUser(ports, "writer@example.com");
		const letter = await storeLetter(env.DB, {
			id: "letter-1",
			senderId: writer.id,
			body: "Hellooo?",
			status: "held",
			now: T0,
		});
		expect(await admitLetter(env.DB, ports, letter, T0)).toEqual({
			kind: "retry-later",
		});
		expect(must(await findLetter(env.DB, letter.id)).status).toBe("held");
		ports.verdict = "deliver";
		expect(await admitLetter(env.DB, ports, letter, T0)).toEqual({
			kind: "accept",
		});
		expect(must(await findLetter(env.DB, letter.id)).status).toBe("traveling");
		expect(await creditsOf(writer)).toBe(1);
	});

	it("draws the journey length from the ports' randomness", async () => {
		const shortest = fakePorts({ uniform: 0 });
		const writer = await seedActiveUser(shortest, "writer@example.com");
		const letter = await storeLetter(env.DB, {
			id: "letter-1",
			senderId: writer.id,
			body: "Hellooo?",
			status: "held",
			now: T0,
		});
		await admitLetter(env.DB, shortest, letter, T0);
		const again = await storeLetter(env.DB, {
			id: "letter-2",
			senderId: writer.id,
			body: "Hellooo again?",
			status: "held",
			now: T0,
		});
		const longest = fakePorts({ uniform: 1 - Number.EPSILON });
		await admitLetter(env.DB, longest, again, T0);
		const first = must(must(await findLetter(env.DB, letter.id)).deliverAfter);
		const second = must(must(await findLetter(env.DB, again.id)).deliverAfter);
		expect(second).not.toBe(first);
		expect(second - T0).toBe(JOURNEY_MAX_MS);
	});
});
