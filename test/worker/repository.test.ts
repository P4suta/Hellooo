import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { DAY_MS } from "../../src/core/duration.ts";
import { addMillis, type Instant, userId } from "../../src/core/types.ts";
import { LETTER_INTERVAL_MS } from "../../src/core/weekly-cap.ts";
import {
	acceptLetter,
	banWriter,
	candidatesFor,
	closeReports,
	completeDelivery,
	confirmLetter,
	createPendingUser,
	dueLetters,
	findDelivery,
	findLetter,
	findLetterByConfirmToken,
	findPendingVerification,
	findUserByEmail,
	findUserById,
	findUserByPageKey,
	heldLetters,
	type Letter,
	lastAcceptedAt,
	operatorNumbers,
	pageKeyOf,
	recordEvent,
	rejectionsInLastDay,
	reportDelivery,
	reportedLetters,
	reserveDelivery,
	setLocale,
	settleLetter,
	storeLetter,
	suppressUser,
	undoDelivery,
	unsubscribe,
	verifyUser,
} from "../../src/worker/repository.ts";
import { must } from "../support/must.ts";
import { useEmptyStorage } from "./d1.ts";
import {
	address,
	creditsOf,
	eventKinds,
	fakePorts,
	pageKeyFor,
	seedActiveUser,
	seedHeldLetter,
	seedTravelingLetter,
	T0,
} from "./fakes.ts";

useEmptyStorage();

describe("users", () => {
	it("are created pending with their language and found by address or id", async () => {
		const user = await createPendingUser(env.DB, {
			id: "user-1",
			email: address("writer@example.jp"),
			verifyToken: "verify-1",
			pageKey: "page-1",
			locale: "ja",
			now: T0,
		});
		expect(user).toEqual({
			id: "user-1",
			email: "writer@example.jp",
			status: "pending",
			credits: 0,
			createdAt: T0,
			verifiedAt: null,
			locale: "ja",
		});
		expect(await findUserByEmail(env.DB, address("writer@example.jp"))).toEqual(
			user,
		);
		expect(await findUserById(env.DB, must(userId("user-1")))).toEqual(user);
		expect(
			await findUserByEmail(env.DB, address("nobody@example.jp")),
		).toBeNull();
		expect(await pageKeyOf(env.DB, user.id)).toBe("page-1");
	});

	it("refuse a second account for the same address", async () => {
		const ports = fakePorts();
		await seedActiveUser(ports, "writer@example.com");
		await expect(
			createPendingUser(env.DB, {
				id: "user-2",
				email: address("writer@example.com"),
				verifyToken: "verify-2",
				pageKey: "page-2",
				locale: "en",
				now: T0,
			}),
		).rejects.toThrow();
	});

	it("read an unknown stored language as the default", async () => {
		const ports = fakePorts();
		const user = await seedActiveUser(ports, "writer@example.com");
		await env.DB.prepare("UPDATE users SET locale = 'xx' WHERE id = ?")
			.bind(user.id)
			.run();
		expect(must(await findUserById(env.DB, user.id)).locale).toBe("en");
	});

	it("become active once with the verification token and hand over the waiting letters in order", async () => {
		const pending = await createPendingUser(env.DB, {
			id: "user-1",
			email: address("writer@example.com"),
			verifyToken: "verify-1",
			pageKey: "page-1",
			locale: "en",
			now: T0,
		});
		await storeLetter(env.DB, {
			id: "letter-b",
			senderId: pending.id,
			body: "second",
			status: "pending_verification",
			now: addMillis(T0, 1),
		});
		await storeLetter(env.DB, {
			id: "letter-a",
			senderId: pending.id,
			body: "first",
			status: "pending_verification",
			now: T0,
		});
		expect(await verifyUser(env.DB, "wrong", T0)).toBeNull();
		const verified = must(
			await verifyUser(env.DB, "verify-1", addMillis(T0, 2)),
		);
		expect(verified.user.status).toBe("active");
		expect(verified.user.verifiedAt).toBe(addMillis(T0, 2));
		expect(verified.waiting.map((letter) => letter.body)).toEqual([
			"first",
			"second",
		]);
		expect(await verifyUser(env.DB, "verify-1", T0)).toBeNull();
		expect(await eventKinds()).toEqual(["user_verified"]);
	});

	it("unsubscribe once and keep the state afterwards", async () => {
		const ports = fakePorts();
		const user = await seedActiveUser(ports, "writer@example.com", 2);
		expect(await unsubscribe(env.DB, "unknown", T0)).toBe(false);
		expect(await unsubscribe(env.DB, "page-writer@example.com", T0)).toBe(true);
		expect(must(await findUserById(env.DB, user.id)).status).toBe(
			"unsubscribed",
		);
		expect(await unsubscribe(env.DB, "page-writer@example.com", T0)).toBe(
			false,
		);
		expect(await eventKinds()).toEqual(["user_verified", "user_unsubscribed"]);
	});

	it("stop receiving once the provider refuses their address, and only once", async () => {
		const ports = fakePorts();
		const user = await seedActiveUser(ports, "gone@example.com", 2);
		expect(await suppressUser(env.DB, user.id, T0)).toBe(true);
		expect(must(await findUserById(env.DB, user.id))).toMatchObject({
			status: "suppressed",
			credits: 2,
		});
		expect(await suppressUser(env.DB, user.id, addMillis(T0, 1))).toBe(false);
		expect(await candidatesFor(env.DB, must(userId("someone-else")))).toEqual(
			[],
		);
		expect(await eventKinds()).toEqual(["user_verified", "user_suppressed"]);
	});

	it("are not suppressed after they stopped or were banned", async () => {
		const ports = fakePorts();
		const stopped = await seedActiveUser(ports, "stopped@example.com");
		await unsubscribe(env.DB, pageKeyFor(stopped.email), T0);
		expect(await suppressUser(env.DB, stopped.id, T0)).toBe(false);
		expect(must(await findUserById(env.DB, stopped.id)).status).toBe(
			"unsubscribed",
		);
	});
});

describe("letters", () => {
	it("are stored and found with their status", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		const letter = await storeLetter(env.DB, {
			id: "letter-1",
			senderId: writer.id,
			body: "Hellooo?",
			status: "pending_confirmation",
			confirmToken: "confirm-1",
			now: T0,
		});
		expect(letter).toEqual({
			id: "letter-1",
			senderId: writer.id,
			body: "Hellooo?",
			status: "pending_confirmation",
			createdAt: T0,
			acceptedAt: null,
			deliverAfter: null,
			erasedAt: null,
		});
		expect(
			await findLetter(env.DB, must(userId("missing")) as unknown as never),
		).toBeNull();
	});

	it("are confirmed once by token", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		await storeLetter(env.DB, {
			id: "letter-1",
			senderId: writer.id,
			body: "Hellooo?",
			status: "pending_confirmation",
			confirmToken: "confirm-1",
			now: T0,
		});
		expect(await confirmLetter(env.DB, "wrong", T0)).toBeNull();
		expect(must(await confirmLetter(env.DB, "confirm-1", T0)).id).toBe(
			"letter-1",
		);
		expect(await confirmLetter(env.DB, "confirm-1", T0)).toBeNull();
		expect(await eventKinds()).toContain("letter_confirmed");
	});

	it("settle as held or rejected with an event each", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		const held = await storeLetter(env.DB, {
			id: "letter-held",
			senderId: writer.id,
			body: "a",
			status: "held",
			now: T0,
		});
		const rejected = await storeLetter(env.DB, {
			id: "letter-rejected",
			senderId: writer.id,
			body: "b",
			status: "held",
			now: T0,
		});
		await settleLetter(env.DB, held.id, writer.id, "held", "review", T0);
		await settleLetter(
			env.DB,
			rejected.id,
			writer.id,
			"rejected",
			"reject",
			T0,
		);
		expect(must(await findLetter(env.DB, held.id)).status).toBe("held");
		expect(must(await findLetter(env.DB, rejected.id)).status).toBe("rejected");
		expect(await eventKinds()).toEqual([
			"user_verified",
			"letter_held",
			"letter_rejected",
		]);
		expect(await rejectionsInLastDay(env.DB, writer.id, T0)).toBe(1);
	});

	it("become due in order of their journey's end, at most a batch at a time", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		const late = await seedTravelingLetter(
			ports,
			writer,
			addMillis(T0, -1),
			"late",
		);
		const early = await seedTravelingLetter(
			ports,
			writer,
			addMillis(T0, -DAY_MS),
			"early",
		);
		await seedTravelingLetter(ports, writer, addMillis(T0, 1), "future");
		await storeLetter(env.DB, {
			id: "held",
			senderId: writer.id,
			body: "held",
			status: "held",
			now: T0,
		});
		expect(
			(await dueLetters(env.DB, T0, 10)).map((letter) => letter.id),
		).toEqual([early.id, late.id]);
		expect(
			(await dueLetters(env.DB, T0, 1)).map((letter) => letter.id),
		).toEqual([early.id]);
		expect(await dueLetters(env.DB, addMillis(T0, -2 * DAY_MS), 10)).toEqual(
			[],
		);
	});
});

describe("credits in the database", () => {
	it("grant one credit per accepted letter and spend one per delivery", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		const reader = await seedActiveUser(ports, "reader@example.com");
		const letter = await storeLetter(env.DB, {
			id: ports.newId(),
			senderId: writer.id,
			body: "Hellooo?",
			status: "held",
			now: T0,
		});
		expect(await lastAcceptedAt(env.DB, writer.id)).toBeNull();
		await acceptLetter(env.DB, {
			letterId: letter.id,
			senderId: writer.id,
			deliverAfter: addMillis(T0, DAY_MS),
			moderation: "deliver",
			now: T0,
		});
		expect(await creditsOf(writer)).toBe(1);
		expect(await lastAcceptedAt(env.DB, writer.id)).toBe(T0);
		expect(must(await findLetter(env.DB, letter.id))).toMatchObject({
			status: "traveling",
			acceptedAt: T0,
			deliverAfter: addMillis(T0, DAY_MS),
		});

		const readerLetter = await seedTravelingLetter(ports, reader, T0);
		expect(await creditsOf(reader)).toBe(0);
		expect(
			await reserveDelivery(env.DB, {
				letterId: readerLetter.id,
				recipientId: writer.id,
				reportToken: "report-1",
				now: T0,
			}),
		).toBe(true);
		expect(await creditsOf(writer)).toBe(0);
		expect(must(await findLetter(env.DB, readerLetter.id)).status).toBe(
			"delivered",
		);
	});

	it("remember the latest acceptance", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		await seedTravelingLetter(ports, writer, T0);
		ports.clock = addMillis(T0, DAY_MS);
		await seedTravelingLetter(ports, writer, T0);
		expect(await lastAcceptedAt(env.DB, writer.id)).toBe(addMillis(T0, DAY_MS));
	});

	it("refuse a delivery to a recipient without a credit and to a letter no longer traveling", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		const broke = await seedActiveUser(ports, "broke@example.com");
		const letter = await seedTravelingLetter(ports, writer, T0);
		expect(
			await reserveDelivery(env.DB, {
				letterId: letter.id,
				recipientId: broke.id,
				reportToken: "report-1",
				now: T0,
			}),
		).toBe(false);
		expect(must(await findLetter(env.DB, letter.id)).status).toBe("traveling");

		const funded = await seedActiveUser(ports, "funded@example.com", 1);
		expect(
			await reserveDelivery(env.DB, {
				letterId: letter.id,
				recipientId: funded.id,
				reportToken: "report-2",
				now: T0,
			}),
		).toBe(true);
		expect(
			await reserveDelivery(env.DB, {
				letterId: letter.id,
				recipientId: funded.id,
				reportToken: "report-3",
				now: T0,
			}),
		).toBe(false);
		expect(await creditsOf(funded)).toBe(0);
	});

	it("refuse a delivery to an inactive recipient", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		const gone = await seedActiveUser(ports, "gone@example.com", 1);
		await unsubscribe(env.DB, "page-gone@example.com", T0);
		const letter = await seedTravelingLetter(ports, writer, T0);
		expect(
			await reserveDelivery(env.DB, {
				letterId: letter.id,
				recipientId: gone.id,
				reportToken: "report-1",
				now: T0,
			}),
		).toBe(false);
		expect(await creditsOf(gone)).toBe(1);
	});

	it("records a settlement only when it changes the letter", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		const held = await seedHeldLetter(ports, writer, "held");
		// The first hold names a moderation the letter lacked; the second changes nothing.
		await settleLetter(env.DB, held.id, writer.id, "held", "pending", T0);
		await settleLetter(env.DB, held.id, writer.id, "held", "pending", T0);
		expect(
			(await eventKinds()).filter((kind) => kind === "letter_held"),
		).toHaveLength(1);
		await settleLetter(env.DB, held.id, writer.id, "rejected", "reject", T0);
		await settleLetter(env.DB, held.id, writer.id, "rejected", "reject", T0);
		expect(
			(await eventKinds()).filter((kind) => kind === "letter_rejected"),
		).toHaveLength(1);
		expect(must(await findLetter(env.DB, held.id)).status).toBe("rejected");
	});

	it("undo a delivery once only, and never a finished one", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		const reader = await seedActiveUser(ports, "reader@example.com", 1);
		const letter = await seedTravelingLetter(ports, writer, T0);
		await reserveDelivery(env.DB, {
			letterId: letter.id,
			recipientId: reader.id,
			reportToken: "report-1",
			now: T0,
		});
		await undoDelivery(env.DB, letter.id, reader.id, T0);
		await undoDelivery(env.DB, letter.id, reader.id, T0);
		expect(await creditsOf(reader)).toBe(1);
		expect(
			(await eventKinds()).filter((kind) => kind === "delivery_undone"),
		).toHaveLength(1);
		await reserveDelivery(env.DB, {
			letterId: letter.id,
			recipientId: reader.id,
			reportToken: "report-2",
			now: T0,
		});
		await completeDelivery(env.DB, letter.id, reader.id, "provider-1", T0);
		await undoDelivery(env.DB, letter.id, reader.id, T0);
		expect(await creditsOf(reader)).toBe(0);
		expect(must(await findLetter(env.DB, letter.id)).status).toBe("delivered");
		expect(
			(await eventKinds()).filter((kind) => kind === "delivery_undone"),
		).toHaveLength(1);
	});

	it("undo a delivery whose mail failed, returning the credit and the journey", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		const reader = await seedActiveUser(ports, "reader@example.com", 1);
		const letter = await seedTravelingLetter(ports, writer, T0);
		await reserveDelivery(env.DB, {
			letterId: letter.id,
			recipientId: reader.id,
			reportToken: "report-1",
			now: T0,
		});
		await undoDelivery(env.DB, letter.id, reader.id, T0);
		expect(await creditsOf(reader)).toBe(1);
		expect(must(await findLetter(env.DB, letter.id)).status).toBe("traveling");
		expect(
			await reserveDelivery(env.DB, {
				letterId: letter.id,
				recipientId: reader.id,
				reportToken: "report-2",
				now: T0,
			}),
		).toBe(true);
		await completeDelivery(env.DB, letter.id, reader.id, "provider-1", T0);
		expect(await eventKinds()).toEqual([
			"user_verified",
			"user_verified",
			"delivery_undone",
			"letter_delivered",
		]);
	});

	it("count only the last day's rejections", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		const other = await seedActiveUser(ports, "other@example.com");
		await recordEvent(env.DB, {
			kind: "letter_rejected",
			userId: writer.id,
			now: addMillis(T0, -DAY_MS),
		});
		await recordEvent(env.DB, {
			kind: "letter_rejected",
			userId: writer.id,
			now: addMillis(T0, -DAY_MS + 1),
		});
		await recordEvent(env.DB, {
			kind: "letter_rejected",
			userId: writer.id,
			now: T0,
		});
		await recordEvent(env.DB, {
			kind: "letter_held",
			userId: writer.id,
			now: T0,
		});
		await recordEvent(env.DB, {
			kind: "letter_rejected",
			userId: other.id,
			now: T0,
		});
		expect(await rejectionsInLastDay(env.DB, writer.id, T0)).toBe(2);
		expect(await rejectionsInLastDay(env.DB, other.id, T0)).toBe(1);
	});
});

describe("candidates for a letter", () => {
	it("are the active credit holders other than the writer, flagged when they already heard from them", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com", 2);
		const fresh = await seedActiveUser(ports, "fresh@example.com", 1);
		const repeat = await seedActiveUser(ports, "repeat@example.com", 1);
		await seedActiveUser(ports, "broke@example.com");
		const gone = await seedActiveUser(ports, "gone@example.com", 1);
		await unsubscribe(env.DB, "page-gone@example.com", T0);
		const earlier = await seedTravelingLetter(ports, writer, T0, "earlier");
		await reserveDelivery(env.DB, {
			letterId: earlier.id,
			recipientId: repeat.id,
			reportToken: "report-1",
			now: T0,
		});
		await env.DB.prepare("UPDATE users SET credits = 1 WHERE id = ?")
			.bind(repeat.id)
			.run();
		const candidates = await candidatesFor(env.DB, writer.id);
		expect(candidates.map((c) => c.id).sort()).toEqual(
			[fresh.id, repeat.id].sort(),
		);
		expect(candidates.find((c) => c.id === fresh.id)?.receivedFromSender).toBe(
			false,
		);
		expect(candidates.find((c) => c.id === repeat.id)?.receivedFromSender).toBe(
			true,
		);
		expect(candidates.some((c) => c.id === gone.id)).toBe(false);
	});
});

describe("reports", () => {
	it("are recorded against the delivered letter's writer", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		const reader = await seedActiveUser(ports, "reader@example.com", 1);
		const letter = await seedTravelingLetter(ports, writer, T0);
		await reserveDelivery(env.DB, {
			letterId: letter.id,
			recipientId: reader.id,
			reportToken: "report-1",
			now: T0,
		});
		expect(await reportDelivery(env.DB, "unknown", T0)).toBeNull();
		expect(await reportDelivery(env.DB, "report-1", T0)).toEqual({
			letterId: letter.id,
			senderId: writer.id,
			recipientId: reader.id,
		});
		const row = await env.DB.prepare(
			"SELECT user_id, letter_id FROM events WHERE kind = 'letter_reported'",
		).first<{ user_id: string; letter_id: string }>();
		expect(row).toEqual({ user_id: writer.id, letter_id: letter.id });
	});

	it("are recorded once per delivery, and the delivery can be read without reporting", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		const reader = await seedActiveUser(ports, "reader@example.com", 1);
		const letter = await seedTravelingLetter(ports, writer, T0);
		await reserveDelivery(env.DB, {
			letterId: letter.id,
			recipientId: reader.id,
			reportToken: "report-1",
			now: T0,
		});
		expect(await findDelivery(env.DB, "report-1")).toEqual({
			letterId: letter.id,
			senderId: writer.id,
			recipientId: reader.id,
		});
		expect(await findDelivery(env.DB, "unknown")).toBeNull();
		expect(await eventKinds()).not.toContain("letter_reported");
		await reportDelivery(env.DB, "report-1", T0);
		await reportDelivery(env.DB, "report-1", addMillis(T0, 1));
		expect(
			(await eventKinds()).filter((kind) => kind === "letter_reported"),
		).toHaveLength(1);
	});
});

describe("the weekly slot at acceptance", () => {
	it("accepts one letter a week for a writer and refuses the next until the week has passed", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		const [first, second, third] = await Promise.all(
			["first", "second", "third"].map((body) =>
				storeLetter(env.DB, {
					id: `letter-${body}`,
					senderId: writer.id,
					body,
					status: "held",
					now: T0,
				}),
			),
		);
		const accept = (letter: Letter, now: Instant) =>
			acceptLetter(env.DB, {
				letterId: letter.id,
				senderId: writer.id,
				deliverAfter: addMillis(now, DAY_MS),
				moderation: "deliver",
				now,
			});
		expect(await accept(must(first), T0)).toBe(true);
		expect(
			await accept(must(second), addMillis(T0, LETTER_INTERVAL_MS - 1)),
		).toBe(false);
		expect(must(await findLetter(env.DB, must(second).id)).status).toBe("held");
		expect(await creditsOf(writer)).toBe(1);
		expect(
			(await eventKinds()).filter((kind) => kind === "letter_accepted"),
		).toHaveLength(1);
		expect(await accept(must(third), addMillis(T0, LETTER_INTERVAL_MS))).toBe(
			true,
		);
		expect(await creditsOf(writer)).toBe(2);
	});

	it("reads a pending verification and a confirmable letter without changing them", async () => {
		const pending = await createPendingUser(env.DB, {
			id: "user-1",
			email: address("writer@example.com"),
			verifyToken: "verify-1",
			pageKey: "page-1",
			locale: "ja",
			now: T0,
		});
		expect(await findPendingVerification(env.DB, "verify-1")).toEqual(pending);
		expect(await findPendingVerification(env.DB, "nope")).toBeNull();
		expect(must(await findUserById(env.DB, pending.id)).status).toBe("pending");
		const letter = await storeLetter(env.DB, {
			id: "letter-1",
			senderId: pending.id,
			body: "Hellooo?",
			status: "pending_confirmation",
			confirmToken: "confirm-1",
			now: T0,
		});
		expect(await findLetterByConfirmToken(env.DB, "confirm-1")).toEqual(letter);
		expect(await findLetterByConfirmToken(env.DB, "nope")).toBeNull();
		expect(must(await findLetter(env.DB, letter.id)).status).toBe(
			"pending_confirmation",
		);
	});
});

describe("the page key", () => {
	it("finds the person it was given and changes their language with an event", async () => {
		const ports = fakePorts();
		const reader = await seedActiveUser(ports, "reader@example.com");
		expect(await findUserByPageKey(env.DB, "nope")).toBeNull();
		expect(
			must(await findUserByPageKey(env.DB, pageKeyFor(reader.email))).id,
		).toBe(reader.id);
		await setLocale(env.DB, reader.id, "ja", T0);
		expect(must(await findUserById(env.DB, reader.id)).locale).toBe("ja");
		expect(await eventKinds()).toEqual(["user_verified", "locale_changed"]);
	});
});

describe("the letters waiting for the model", () => {
	it("are listed oldest first, at most a batch at a time", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		const later = await seedHeldLetter(ports, writer, "later");
		ports.clock = addMillis(T0, -1);
		const earlier = await seedHeldLetter(ports, writer, "earlier");
		await seedTravelingLetter(ports, writer, T0, "not held");
		expect(
			(await heldLetters(env.DB, 10)).map((letter) => letter.body),
		).toEqual(["earlier", "later"]);
		expect((await heldLetters(env.DB, 1)).map((letter) => letter.id)).toEqual([
			earlier.id,
		]);
		expect(later.status).toBe("held");
	});

	it("lists reported letters with their counts until closed or the writer is banned", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		const reader = await seedActiveUser(ports, "reader@example.com", 2);
		const other = await seedActiveUser(ports, "other@example.com");
		const first = await seedTravelingLetter(ports, writer, T0, "first");
		const second = await seedTravelingLetter(ports, other, T0, "second");
		await reserveDelivery(env.DB, {
			letterId: first.id,
			recipientId: reader.id,
			reportToken: "report-1",
			now: T0,
		});
		await reserveDelivery(env.DB, {
			letterId: second.id,
			recipientId: reader.id,
			reportToken: "report-2",
			now: T0,
		});
		expect(await reportedLetters(env.DB)).toEqual([]);
		await reportDelivery(env.DB, "report-2", T0);
		await reportDelivery(env.DB, "report-2", addMillis(T0, 1));
		await reportDelivery(env.DB, "report-1", addMillis(T0, 2));
		expect(
			(await reportedLetters(env.DB)).map(({ letter, reports }) => [
				letter.body,
				reports,
			]),
		).toEqual([
			["first", 1],
			["second", 1],
		]);

		await closeReports(env.DB, second.id, addMillis(T0, 2));
		expect(
			(await reportedLetters(env.DB)).map(({ letter }) => letter.body),
		).toEqual(["first"]);
		// One delivery carries one report, so the closed letter stays closed.
		await reportDelivery(env.DB, "report-2", addMillis(T0, 3));
		expect(
			(await reportedLetters(env.DB)).map(({ letter }) => letter.body),
		).toEqual(["first"]);

		await banWriter(env.DB, writer.id, addMillis(T0, 4));
		expect(await reportedLetters(env.DB)).toEqual([]);
	});

	it("bans a writer and loses the letters still held or on their way, keeping delivered ones", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com", 1);
		const reader = await seedActiveUser(ports, "reader@example.com", 1);
		const delivered = await seedTravelingLetter(ports, writer, T0, "delivered");
		await reserveDelivery(env.DB, {
			letterId: delivered.id,
			recipientId: reader.id,
			reportToken: "report-1",
			now: T0,
		});
		const traveling = await seedTravelingLetter(ports, writer, T0, "traveling");
		const held = await seedHeldLetter(ports, writer, "held");
		const unconfirmed = await storeLetter(env.DB, {
			id: "letter-unconfirmed",
			senderId: writer.id,
			body: "unconfirmed",
			status: "pending_confirmation",
			confirmToken: "confirm-banned",
			now: T0,
		});
		await banWriter(env.DB, writer.id, T0);
		expect(must(await findLetter(env.DB, unconfirmed.id)).status).toBe("lost");
		expect(await findLetterByConfirmToken(env.DB, "confirm-banned")).toBeNull();
		expect(must(await findUserById(env.DB, writer.id)).status).toBe("banned");
		expect(must(await findLetter(env.DB, delivered.id)).status).toBe(
			"delivered",
		);
		expect(must(await findLetter(env.DB, traveling.id)).status).toBe("lost");
		expect(must(await findLetter(env.DB, held.id)).status).toBe("lost");
		expect(await creditsOf(writer)).toBe(1);
		expect(await dueLetters(env.DB, addMillis(T0, DAY_MS), 10)).toEqual([]);
		expect(await candidatesFor(env.DB, reader.id)).toEqual([]);
		expect(await eventKinds()).toContain("user_banned");
	});

	it("counts the people who receive, the letters on their way, and the delivered ones", async () => {
		const ports = fakePorts();
		expect(await operatorNumbers(env.DB)).toEqual({
			receiving: 0,
			onTheirWay: 0,
			delivered: 0,
		});
		const writer = await seedActiveUser(ports, "writer@example.com");
		const reader = await seedActiveUser(ports, "reader@example.com", 1);
		await seedActiveUser(ports, "gone@example.com");
		await unsubscribe(env.DB, "page-gone@example.com", T0);
		const sent = await seedTravelingLetter(ports, writer, T0, "sent");
		await seedTravelingLetter(ports, writer, T0, "on its way");
		await seedHeldLetter(ports, writer, "held");
		await reserveDelivery(env.DB, {
			letterId: sent.id,
			recipientId: reader.id,
			reportToken: "report-1",
			now: T0,
		});
		expect(await operatorNumbers(env.DB)).toEqual({
			receiving: 2,
			onTheirWay: 1,
			delivered: 1,
		});
	});
});
