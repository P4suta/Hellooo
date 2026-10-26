import { z } from "zod";
import { DAY_MS } from "../core/duration.ts";
import {
	DEFAULT_LOCALE,
	type Locale,
	localeFromLanguageTag,
} from "../core/locale.ts";
import type { Candidate } from "../core/recipient-selection.ts";
import {
	type EmailAddress,
	type Instant,
	instant,
	LETTER_STATUSES,
	type LetterId,
	letterId,
	USER_STATUSES,
	type UserId,
	type UserStatus,
	userId,
} from "../core/types.ts";

export type EventKind =
	| "mail_ignored"
	| "user_registered"
	| "verification_sent"
	| "confirmation_sent"
	| "letter_stored"
	| "letter_accepted"
	| "letter_rejected"
	| "letter_held"
	| "letter_over_cap"
	| "rejections_exhausted"
	| "reply_failed"
	| "letter_delivered"
	| "delivery_undone"
	| "user_verified"
	| "letter_confirmed"
	| "user_unsubscribed"
	| "locale_changed"
	| "letter_reported"
	| "report_closed"
	| "user_banned"
	| "user_suppressed"
	| "send_failed"
	| "letter_erased";

const UserRowSchema = z.object({
	id: z.string().min(1),
	email: z.string().min(1),
	status: z.enum(USER_STATUSES),
	credits: z.number().int().nonnegative(),
	created_at: z.number().int(),
	verified_at: z.number().int().nullable(),
	locale: z.string().min(1),
});

const LetterRowSchema = z.object({
	id: z.string().min(1),
	sender_id: z.string().min(1),
	body: z.string(),
	status: z.enum(LETTER_STATUSES),
	created_at: z.number().int(),
	accepted_at: z.number().int().nullable(),
	deliver_after: z.number().int().nullable(),
	erased_at: z.number().int().nullable(),
});

const CandidateRowSchema = z.object({
	id: z.string().min(1),
	status: z.enum(USER_STATUSES),
	credits: z.number().int().nonnegative(),
	received_from_sender: z.number().int(),
});

const CountRowSchema = z.object({ n: z.number().int().nonnegative() });
const LastRowSchema = z.object({ last: z.number().int().nullable() });
const IdRowSchema = z.object({ id: z.string().min(1) });
const ReportedRowSchema = LetterRowSchema.extend({
	reports: z.number().int().positive(),
});
const NumbersRowSchema = z.object({
	receiving: z.number().int().nonnegative(),
	on_their_way: z.number().int().nonnegative(),
	delivered: z.number().int().nonnegative(),
});

export type User = {
	readonly id: UserId;
	readonly email: EmailAddress;
	readonly status: UserStatus;
	readonly credits: number;
	readonly createdAt: Instant;
	readonly verifiedAt: Instant | null;
	readonly locale: Locale;
};

export type Letter = {
	readonly id: LetterId;
	readonly senderId: UserId;
	readonly body: string;
	readonly status: (typeof LETTER_STATUSES)[number];
	readonly createdAt: Instant;
	readonly acceptedAt: Instant | null;
	readonly deliverAfter: Instant | null;
	/** When the text was erased after the retention period; the body is empty from then on. */
	readonly erasedAt: Instant | null;
};

function stored<T>(value: T | null, what: string): T {
	if (value === null) {
		throw new Error(`the database holds an invalid ${what}`);
	}
	return value;
}

function toUser(row: z.infer<typeof UserRowSchema>): User {
	return {
		id: stored(userId(row.id), "user id"),
		email: row.email as EmailAddress,
		status: row.status,
		credits: row.credits,
		createdAt: stored(instant(row.created_at), "timestamp"),
		verifiedAt:
			row.verified_at === null
				? null
				: stored(instant(row.verified_at), "timestamp"),
		locale: localeFromLanguageTag(row.locale) ?? DEFAULT_LOCALE,
	};
}

function toLetter(row: z.infer<typeof LetterRowSchema>): Letter {
	return {
		id: stored(letterId(row.id), "letter id"),
		senderId: stored(userId(row.sender_id), "user id"),
		body: row.body,
		status: row.status,
		createdAt: stored(instant(row.created_at), "timestamp"),
		acceptedAt:
			row.accepted_at === null
				? null
				: stored(instant(row.accepted_at), "timestamp"),
		deliverAfter:
			row.deliver_after === null
				? null
				: stored(instant(row.deliver_after), "timestamp"),
		erasedAt:
			row.erased_at === null
				? null
				: stored(instant(row.erased_at), "timestamp"),
	};
}

const USER_COLUMNS =
	"id, email, status, credits, created_at, verified_at, locale";
const LETTER_COLUMNS =
	"id, sender_id, body, status, created_at, accepted_at, deliver_after, erased_at";

export async function findUserByEmail(
	db: D1Database,
	email: EmailAddress,
): Promise<User | null> {
	const row = await db
		.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?`)
		.bind(email)
		.first();
	return row === null ? null : toUser(UserRowSchema.parse(row));
}

export async function findUserById(
	db: D1Database,
	id: UserId,
): Promise<User | null> {
	const row = await db
		.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`)
		.bind(id)
		.first();
	return row === null ? null : toUser(UserRowSchema.parse(row));
}

/** The person whose page key this is; the key reaches them in every mail and opens the page about their address. */
export async function findUserByPageKey(
	db: D1Database,
	pageKey: string,
): Promise<User | null> {
	const row = await db
		.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE page_key = ?`)
		.bind(pageKey)
		.first();
	return row === null ? null : toUser(UserRowSchema.parse(row));
}

export type NewUser = {
	readonly id: string;
	readonly email: EmailAddress;
	readonly verifyToken: string;
	readonly pageKey: string;
	readonly locale: Locale;
	readonly now: Instant;
};

export async function createPendingUser(
	db: D1Database,
	user: NewUser,
): Promise<User> {
	await db
		.prepare(
			"INSERT INTO users (id, email, status, credits, verify_token, page_key, locale, created_at) VALUES (?, ?, 'pending', 0, ?, ?, ?, ?)",
		)
		.bind(
			user.id,
			user.email,
			user.verifyToken,
			user.pageKey,
			user.locale,
			user.now,
		)
		.run();
	return stored(
		await findUserById(db, stored(userId(user.id), "user id")),
		"user",
	);
}

export async function refreshVerifyToken(
	db: D1Database,
	id: UserId,
	verifyToken: string,
): Promise<void> {
	await db
		.prepare(
			"UPDATE users SET verify_token = ? WHERE id = ? AND status = 'pending'",
		)
		.bind(verifyToken, id)
		.run();
}

/** Changes the language of every later mail and page for this person. */
export async function setLocale(
	db: D1Database,
	id: UserId,
	locale: Locale,
	now: Instant,
): Promise<void> {
	await db.batch([
		db.prepare("UPDATE users SET locale = ? WHERE id = ?").bind(locale, id),
		eventStatement(db, { kind: "locale_changed", userId: id, now }),
	]);
}

export async function lastAcceptedAt(
	db: D1Database,
	senderId: UserId,
): Promise<Instant | null> {
	const row = await db
		.prepare(
			"SELECT MAX(accepted_at) AS last FROM letters WHERE sender_id = ? AND accepted_at IS NOT NULL",
		)
		.bind(senderId)
		.first();
	const { last } = LastRowSchema.parse(row);
	return last === null ? null : stored(instant(last), "timestamp");
}

export async function rejectionsInLastDay(
	db: D1Database,
	senderId: UserId,
	now: Instant,
): Promise<number> {
	const row = await db
		.prepare(
			"SELECT COUNT(*) AS n FROM events WHERE user_id = ? AND kind = 'letter_rejected' AND created_at > ?",
		)
		.bind(senderId, now - DAY_MS)
		.first();
	return CountRowSchema.parse(row).n;
}

export type NewEvent = {
	readonly kind: EventKind;
	readonly userId?: UserId | undefined;
	readonly letterId?: LetterId | undefined;
	readonly detail?: string | undefined;
	readonly now: Instant;
};

export function eventStatement(
	db: D1Database,
	event: NewEvent,
): D1PreparedStatement {
	return db
		.prepare(
			"INSERT INTO events (kind, user_id, letter_id, detail, created_at) VALUES (?, ?, ?, ?, ?)",
		)
		.bind(
			event.kind,
			event.userId ?? null,
			event.letterId ?? null,
			event.detail ?? null,
			event.now,
		);
}

export async function recordEvent(
	db: D1Database,
	event: NewEvent,
): Promise<void> {
	await eventStatement(db, event).run();
}

export type NewLetter = {
	readonly id: string;
	readonly senderId: UserId;
	readonly body: string;
	readonly status: "pending_verification" | "pending_confirmation" | "held";
	readonly confirmToken?: string;
	readonly now: Instant;
};

export async function storeLetter(
	db: D1Database,
	letter: NewLetter,
): Promise<Letter> {
	await db
		.prepare(
			"INSERT INTO letters (id, sender_id, body, status, confirm_token, created_at) VALUES (?, ?, ?, ?, ?, ?)",
		)
		.bind(
			letter.id,
			letter.senderId,
			letter.body,
			letter.status,
			letter.confirmToken ?? null,
			letter.now,
		)
		.run();
	return stored(
		await findLetter(db, stored(letterId(letter.id), "letter id")),
		"letter",
	);
}

export async function findLetter(
	db: D1Database,
	id: LetterId,
): Promise<Letter | null> {
	const row = await db
		.prepare(`SELECT ${LETTER_COLUMNS} FROM letters WHERE id = ?`)
		.bind(id)
		.first();
	return row === null ? null : toLetter(LetterRowSchema.parse(row));
}

export type Acceptance = {
	readonly letterId: LetterId;
	readonly senderId: UserId;
	readonly deliverAfter: Instant;
	readonly moderation: string;
	readonly now: Instant;
};

/** Marks the letter traveling and grants the sender one credit in one transaction. */
export async function acceptLetter(
	db: D1Database,
	acceptance: Acceptance,
): Promise<void> {
	await db.batch([
		db
			.prepare(
				"UPDATE letters SET status = 'traveling', accepted_at = ?, deliver_after = ?, moderation = ?, confirm_token = NULL WHERE id = ?",
			)
			.bind(
				acceptance.now,
				acceptance.deliverAfter,
				acceptance.moderation,
				acceptance.letterId,
			),
		db
			.prepare("UPDATE users SET credits = credits + 1 WHERE id = ?")
			.bind(acceptance.senderId),
		eventStatement(db, {
			kind: "letter_accepted",
			userId: acceptance.senderId,
			letterId: acceptance.letterId,
			now: acceptance.now,
		}),
	]);
}

export async function settleLetter(
	db: D1Database,
	id: LetterId,
	senderId: UserId,
	status: "rejected" | "held",
	moderation: string,
	now: Instant,
): Promise<void> {
	await db.batch([
		db
			.prepare(
				"UPDATE letters SET status = ?, moderation = ?, confirm_token = NULL WHERE id = ?",
			)
			.bind(status, moderation, id),
		eventStatement(db, {
			kind: status === "rejected" ? "letter_rejected" : "letter_held",
			userId: senderId,
			letterId: id,
			now,
		}),
	]);
}

/** Activates the user who holds this verification token and returns them with their waiting letters. */
export async function verifyUser(
	db: D1Database,
	verifyToken: string,
	now: Instant,
): Promise<{
	readonly user: User;
	readonly waiting: readonly Letter[];
} | null> {
	const row = await db
		.prepare(
			"UPDATE users SET status = 'active', verified_at = ?, verify_token = NULL WHERE verify_token = ? AND status = 'pending' RETURNING id",
		)
		.bind(now, verifyToken)
		.first();
	if (row === null) {
		return null;
	}
	const id = stored(userId(IdRowSchema.parse(row).id), "user id");
	const user = stored(await findUserById(db, id), "user");
	const { results } = await db
		.prepare(
			`SELECT ${LETTER_COLUMNS} FROM letters WHERE sender_id = ? AND status = 'pending_verification' ORDER BY created_at`,
		)
		.bind(id)
		.all();
	await recordEvent(db, { kind: "user_verified", userId: id, now });
	return {
		user,
		waiting: z.array(LetterRowSchema).parse(results).map(toLetter),
	};
}

export async function confirmLetter(
	db: D1Database,
	confirmToken: string,
	now: Instant,
): Promise<Letter | null> {
	const row = await db
		.prepare(
			`UPDATE letters SET confirm_token = NULL WHERE confirm_token = ? AND status = 'pending_confirmation' RETURNING ${LETTER_COLUMNS}`,
		)
		.bind(confirmToken)
		.first();
	if (row === null) {
		return null;
	}
	const letter = toLetter(LetterRowSchema.parse(row));
	await recordEvent(db, {
		kind: "letter_confirmed",
		userId: letter.senderId,
		letterId: letter.id,
		now,
	});
	return letter;
}

/** Stops letters for the person whose page key this is; true when this call changed their state. */
export async function unsubscribe(
	db: D1Database,
	pageKey: string,
	now: Instant,
): Promise<boolean> {
	const row = await db
		.prepare(
			"UPDATE users SET status = 'unsubscribed' WHERE page_key = ? AND status IN ('pending', 'active') RETURNING id",
		)
		.bind(pageKey)
		.first();
	if (row === null) {
		return false;
	}
	await recordEvent(db, {
		kind: "user_unsubscribed",
		userId: stored(userId(IdRowSchema.parse(row).id), "user id"),
		now,
	});
	return true;
}

/** Stops letters to a person whose address the mail provider refuses after a hard bounce or a complaint; true when this call changed their state. */
export async function suppressUser(
	db: D1Database,
	id: UserId,
	now: Instant,
): Promise<boolean> {
	const row = await db
		.prepare(
			"UPDATE users SET status = 'suppressed' WHERE id = ? AND status IN ('pending', 'active') RETURNING id",
		)
		.bind(id)
		.first();
	if (row === null) {
		return false;
	}
	await recordEvent(db, { kind: "user_suppressed", userId: id, now });
	return true;
}

export type Report = {
	readonly letterId: LetterId;
	readonly senderId: UserId;
	readonly recipientId: UserId;
};

/** Records a report against the delivered letter behind this report token, naming its writer and its reader. */
export async function reportDelivery(
	db: D1Database,
	reportToken: string,
	now: Instant,
): Promise<Report | null> {
	const row = await db
		.prepare(
			"SELECT l.id AS id, l.sender_id AS sender_id, d.recipient_id AS recipient_id FROM deliveries d JOIN letters l ON l.id = d.letter_id WHERE d.report_token = ?",
		)
		.bind(reportToken)
		.first();
	if (row === null) {
		return null;
	}
	const parsed = z
		.object({
			id: z.string().min(1),
			sender_id: z.string().min(1),
			recipient_id: z.string().min(1),
		})
		.parse(row);
	const report: Report = {
		letterId: stored(letterId(parsed.id), "letter id"),
		senderId: stored(userId(parsed.sender_id), "user id"),
		recipientId: stored(userId(parsed.recipient_id), "user id"),
	};
	await recordEvent(db, {
		kind: "letter_reported",
		userId: report.senderId,
		letterId: report.letterId,
		now,
	});
	return report;
}

export async function dueLetters(
	db: D1Database,
	now: Instant,
	limit: number,
): Promise<Letter[]> {
	const { results } = await db
		.prepare(
			`SELECT ${LETTER_COLUMNS} FROM letters WHERE status = 'traveling' AND deliver_after <= ? ORDER BY deliver_after LIMIT ?`,
		)
		.bind(now, limit)
		.all();
	return z.array(LetterRowSchema).parse(results).map(toLetter);
}

/** Active credit holders other than the sender, flagged when they already received a letter from this sender. */
export async function candidatesFor(
	db: D1Database,
	senderId: UserId,
): Promise<Candidate[]> {
	const { results } = await db
		.prepare(
			"SELECT u.id AS id, u.status AS status, u.credits AS credits, EXISTS (SELECT 1 FROM deliveries d JOIN letters l ON l.id = d.letter_id WHERE d.recipient_id = u.id AND l.sender_id = ?) AS received_from_sender FROM users u WHERE u.status = 'active' AND u.credits > 0 AND u.id != ?",
		)
		.bind(senderId, senderId)
		.all();
	return z
		.array(CandidateRowSchema)
		.parse(results)
		.map((row) => ({
			id: stored(userId(row.id), "user id"),
			status: row.status,
			credits: row.credits,
			receivedFromSender: row.received_from_sender !== 0,
		}));
}

export type Reservation = {
	readonly letterId: LetterId;
	readonly recipientId: UserId;
	readonly reportToken: string;
	readonly now: Instant;
};

/**
 * Records the delivery, spends the recipient's credit, and marks the letter delivered in one transaction.
 * Every statement conditions on the delivery row of this attempt's report token, so a recipient without a credit or a letter no longer traveling changes nothing.
 */
export async function reserveDelivery(
	db: D1Database,
	reservation: Reservation,
): Promise<boolean> {
	const [inserted] = await db.batch([
		db
			.prepare(
				"INSERT INTO deliveries (letter_id, recipient_id, report_token, sent_at) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND status = 'active' AND credits > 0) AND EXISTS (SELECT 1 FROM letters WHERE id = ? AND status = 'traveling')",
			)
			.bind(
				reservation.letterId,
				reservation.recipientId,
				reservation.reportToken,
				reservation.now,
				reservation.recipientId,
				reservation.letterId,
			),
		db
			.prepare(
				"UPDATE users SET credits = credits - 1 WHERE id = ? AND EXISTS (SELECT 1 FROM deliveries WHERE letter_id = ? AND recipient_id = ? AND report_token = ?)",
			)
			.bind(
				reservation.recipientId,
				reservation.letterId,
				reservation.recipientId,
				reservation.reportToken,
			),
		db
			.prepare(
				"UPDATE letters SET status = 'delivered' WHERE id = ? AND EXISTS (SELECT 1 FROM deliveries WHERE letter_id = ? AND report_token = ?)",
			)
			.bind(
				reservation.letterId,
				reservation.letterId,
				reservation.reportToken,
			),
	]);
	return (inserted?.meta.changes ?? 0) === 1;
}

export async function completeDelivery(
	db: D1Database,
	id: LetterId,
	recipientId: UserId,
	providerMessageId: string,
	now: Instant,
): Promise<void> {
	await db.batch([
		db
			.prepare(
				"UPDATE deliveries SET provider_message_id = ? WHERE letter_id = ?",
			)
			.bind(providerMessageId, id),
		eventStatement(db, {
			kind: "letter_delivered",
			userId: recipientId,
			letterId: id,
			now,
		}),
	]);
}

/** Returns the letter to its journey and the credit to the recipient after the mail could not be sent. */
export async function undoDelivery(
	db: D1Database,
	id: LetterId,
	recipientId: UserId,
	now: Instant,
): Promise<void> {
	await db.batch([
		db.prepare("DELETE FROM deliveries WHERE letter_id = ?").bind(id),
		db
			.prepare("UPDATE users SET credits = credits + 1 WHERE id = ?")
			.bind(recipientId),
		db.prepare("UPDATE letters SET status = 'traveling' WHERE id = ?").bind(id),
		eventStatement(db, {
			kind: "delivery_undone",
			userId: recipientId,
			letterId: id,
			now,
		}),
	]);
}

export async function pageKeyOf(db: D1Database, id: UserId): Promise<string> {
	const row = await db
		.prepare("SELECT page_key FROM users WHERE id = ?")
		.bind(id)
		.first();
	return z.object({ page_key: z.string().min(1) }).parse(row).page_key;
}

/** The letters still waiting for the model's verdict, oldest first, at most a batch at a time. */
export async function heldLetters(
	db: D1Database,
	limit: number,
): Promise<Letter[]> {
	const { results } = await db
		.prepare(
			`SELECT ${LETTER_COLUMNS} FROM letters WHERE status = 'held' ORDER BY created_at, id LIMIT ?`,
		)
		.bind(limit)
		.all();
	return z.array(LetterRowSchema).parse(results).map(toLetter);
}

export type ReportedLetter = {
	readonly letter: Letter;
	readonly reports: number;
};

/** Delivered letters with open reports, most reported first; a banned writer's letters and closed reports stay out. */
export async function reportedLetters(
	db: D1Database,
): Promise<ReportedLetter[]> {
	const { results } = await db
		.prepare(
			`SELECT ${LETTER_COLUMNS.replaceAll(/(\w+)/g, "l.$1")}, COUNT(e.id) AS reports FROM letters l JOIN users u ON u.id = l.sender_id JOIN events e ON e.letter_id = l.id AND e.kind = 'letter_reported' WHERE u.status != 'banned' AND NOT EXISTS (SELECT 1 FROM events c WHERE c.letter_id = l.id AND c.kind = 'report_closed' AND c.id > e.id) GROUP BY l.id ORDER BY reports DESC, l.created_at, l.id`,
		)
		.all();
	return z
		.array(ReportedRowSchema)
		.parse(results)
		.map((row) => ({ letter: toLetter(row), reports: row.reports }));
}

/** Takes the reported letter out of the operator's queue without judging its writer. */
export async function closeReports(
	db: D1Database,
	id: LetterId,
	now: Instant,
): Promise<void> {
	await recordEvent(db, { kind: "report_closed", letterId: id, now });
}

/** Bans a writer: no more mail is taken from them, and their letters still held or on their way are lost. */
export async function banWriter(
	db: D1Database,
	id: UserId,
	now: Instant,
): Promise<void> {
	await db.batch([
		db.prepare("UPDATE users SET status = 'banned' WHERE id = ?").bind(id),
		db
			.prepare(
				"UPDATE letters SET status = 'lost' WHERE sender_id = ? AND status IN ('held', 'traveling')",
			)
			.bind(id),
		eventStatement(db, { kind: "user_banned", userId: id, now }),
	]);
}

export type Erasure = {
	/** Letters settled at or before this instant lose their text: delivered ones by their delivery, the rest by their arrival. */
	readonly settledBefore: Instant;
	readonly now: Instant;
};

/**
 * The letters whose text may go, as `src/core/erasure.ts` decides it: not on their way, not waiting for the model, under no open report, and settled early enough.
 * `letters` names the table of the statement this condition sits in.
 */
const ERASABLE =
	"erased_at IS NULL AND status NOT IN ('held', 'traveling') AND NOT EXISTS (SELECT 1 FROM events r WHERE r.letter_id = letters.id AND r.kind = 'letter_reported' AND NOT EXISTS (SELECT 1 FROM events c WHERE c.letter_id = letters.id AND c.kind = 'report_closed' AND c.id > r.id)) AND COALESCE((SELECT d.sent_at FROM deliveries d WHERE d.letter_id = letters.id), created_at) <= ?";

/**
 * Erases the text of every letter that settled before the given instant, in one transaction with the events that record it.
 * A letter that never went out, because nobody confirmed it, is lost from then on, and its confirmation link stops working.
 */
export async function eraseLetters(
	db: D1Database,
	erasure: Erasure,
): Promise<number> {
	const [, erased] = await db.batch([
		db
			.prepare(
				`INSERT INTO events (kind, user_id, letter_id, detail, created_at) SELECT 'letter_erased', sender_id, id, NULL, ? FROM letters WHERE ${ERASABLE}`,
			)
			.bind(erasure.now, erasure.settledBefore),
		db
			.prepare(
				`UPDATE letters SET body = '', erased_at = ?, confirm_token = NULL, status = CASE WHEN status IN ('pending_verification', 'pending_confirmation') THEN 'lost' ELSE status END WHERE ${ERASABLE}`,
			)
			.bind(erasure.now, erasure.settledBefore),
	]);
	return erased?.meta.changes ?? 0;
}

export type Numbers = {
	readonly receiving: number;
	readonly onTheirWay: number;
	readonly delivered: number;
};

/** How many people receive letters, how many letters are on their way, and how many have been delivered. */
export async function operatorNumbers(db: D1Database): Promise<Numbers> {
	const row = await db
		.prepare(
			"SELECT (SELECT COUNT(*) FROM users WHERE status = 'active') AS receiving, (SELECT COUNT(*) FROM letters WHERE status = 'traveling') AS on_their_way, (SELECT COUNT(*) FROM letters WHERE status = 'delivered') AS delivered",
		)
		.first();
	const parsed = NumbersRowSchema.parse(row);
	return {
		receiving: parsed.receiving,
		onTheirWay: parsed.on_their_way,
		delivered: parsed.delivered,
	};
}
