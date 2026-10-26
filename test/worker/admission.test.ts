import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { DAY_MS } from "../../src/core/duration.ts";
import {
	JOURNEY_MAX_MS,
	JOURNEY_MIN_MS,
} from "../../src/core/journey-schedule.ts";
import { addMillis } from "../../src/core/types.ts";
import { LETTER_INTERVAL_MS } from "../../src/core/weekly-cap.ts";
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

	it("drops a letter whose writer already had one accepted this week, and names the next allowed time", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		const first = await storeLetter(env.DB, {
			id: "letter-1",
			senderId: writer.id,
			body: "First",
			status: "held",
			now: T0,
		});
		const second = await storeLetter(env.DB, {
			id: "letter-2",
			senderId: writer.id,
			body: "Second",
			status: "pending_confirmation",
			confirmToken: "confirm-2",
			now: T0,
		});
		expect(await admitLetter(env.DB, ports, first, T0)).toEqual({
			kind: "accept",
		});
		const later = addMillis(T0, DAY_MS);
		expect(await admitLetter(env.DB, ports, second, later)).toEqual({
			kind: "over-cap",
			nextAllowedAt: addMillis(T0, LETTER_INTERVAL_MS),
		});
		expect(must(await findLetter(env.DB, second.id))).toMatchObject({
			status: "lost",
			acceptedAt: null,
		});
		expect(await creditsOf(writer)).toBe(1);
		expect(await eventKinds()).toContain("letter_over_cap");
		const third = await storeLetter(env.DB, {
			id: "letter-3",
			senderId: writer.id,
			body: "Third",
			status: "held",
			now: later,
		});
		expect(
			await admitLetter(
				env.DB,
				ports,
				third,
				addMillis(T0, LETTER_INTERVAL_MS),
			),
		).toEqual({ kind: "accept" });
		expect(await creditsOf(writer)).toBe(2);
	});

	it("treats a letter another run accepted meanwhile as accepted, without a second credit", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		const letter = await storeLetter(env.DB, {
			id: "letter-1",
			senderId: writer.id,
			body: "Hellooo?",
			status: "held",
			now: T0,
		});
		expect(await admitLetter(env.DB, ports, letter, T0)).toEqual({
			kind: "accept",
		});
		// The intake still holds the stale `held` row while the scheduled run has accepted the same letter.
		expect(await admitLetter(env.DB, ports, letter, T0)).toEqual({
			kind: "accept",
		});
		expect(await creditsOf(writer)).toBe(1);
		expect(
			(await eventKinds()).filter((kind) => kind === "letter_accepted"),
		).toHaveLength(1);
		expect(await eventKinds()).not.toContain("letter_over_cap");
		expect(must(await findLetter(env.DB, letter.id)).status).toBe("traveling");
	});

	it("leaves a traveling letter alone when a stale run would refuse or hold it", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		const letter = await storeLetter(env.DB, {
			id: "letter-1",
			senderId: writer.id,
			body: "Hellooo?",
			status: "held",
			now: T0,
		});
		await admitLetter(env.DB, ports, letter, T0);
		ports.verdict = "reject";
		expect(await admitLetter(env.DB, ports, letter, T0)).toEqual({
			kind: "reject-content",
		});
		ports.verdict = null;
		expect(await admitLetter(env.DB, ports, letter, T0)).toEqual({
			kind: "retry-later",
		});
		expect(must(await findLetter(env.DB, letter.id)).status).toBe("traveling");
		expect(await eventKinds()).not.toContain("letter_rejected");
		expect(await eventKinds()).not.toContain("letter_held");
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
		const other = await seedActiveUser(shortest, "other@example.com");
		const again = await storeLetter(env.DB, {
			id: "letter-2",
			senderId: other.id,
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
