import { describe, expect, it } from "vitest";
import { z } from "zod";
import creditLedgerVectors from "../../proofs/vectors/credit-ledger.json?raw";
import erasureVectors from "../../proofs/vectors/erasure.json?raw";
import intakeVectors from "../../proofs/vectors/intake-decision.json?raw";
import journeyVectors from "../../proofs/vectors/journey-schedule.json?raw";
import originVectors from "../../proofs/vectors/mail-origin.json?raw";
import moderationVectors from "../../proofs/vectors/moderation-verdict.json?raw";
import recipientVectors from "../../proofs/vectors/recipient-selection.json?raw";
import capVectors from "../../proofs/vectors/weekly-cap.json?raw";
import youPageVectors from "../../proofs/vectors/you-page.json?raw";
import {
	creditsOf,
	emptyLedger,
	type Ledger,
	recordAccepted,
	recordDelivered,
	recordUndone,
} from "../../src/core/credit-ledger.ts";
import { normalizeEmailAddress } from "../../src/core/email-address.ts";
import { eraseBody } from "../../src/core/erasure.ts";
import { decideIntake } from "../../src/core/intake-decision.ts";
import { clampJourney, unitInterval } from "../../src/core/journey-schedule.ts";
import type { LetterTextProblem } from "../../src/core/letter-text.ts";
import { originProblem } from "../../src/core/mail-origin.ts";
import {
	MODERATION_QUESTIONS,
	verdictFromProbabilities,
} from "../../src/core/moderation-verdict.ts";
import {
	eligibleRecipients,
	selectRecipient,
} from "../../src/core/recipient-selection.ts";
import {
	DMARC_RESULTS,
	instant,
	LETTER_STATUSES,
	USER_STATUSES,
	type UserId,
	userId,
} from "../../src/core/types.ts";
import { rejectionsRemaining, weeklyCap } from "../../src/core/weekly-cap.ts";
import { youControls, youView } from "../../src/core/you-page.ts";
import { must } from "../support/must.ts";

/**
 * The vectors come from `proofs/Vectors.lean`: the Lean models whose theorems `lake build` checks, evaluated over their whole abstract input domains.
 * Each test replays them against the TypeScript implementation, which binds the proofs to the code that runs.
 */

const PROBLEMS = ["empty", "url", "email-address", "phone-number"] as const;
const Int = z.number().int();
const Instant = Int.transform((ms) => must(instant(ms)));
const Address = z.string().transform((raw) => must(normalizeEmailAddress(raw)));
const Status = z.enum(USER_STATUSES);

const id = (raw: string): UserId => must(userId(raw));

const IntakeVector = z.object({
	sender: z
		.object({
			status: Status,
			lastAcceptedAt: Instant.nullable(),
			rejectionsInLastDay: Int,
		})
		.nullable(),
	dmarc: z.enum(DMARC_RESULTS),
	now: Instant,
	text: z.union([z.literal("ok"), z.object({ problem: z.enum(PROBLEMS) })]),
	decision: z.object({ kind: z.string() }).passthrough(),
});

describe("the intake decision agrees with the proved model on its whole abstract domain", () => {
	const vectors = z.array(IntakeVector).parse(JSON.parse(intakeVectors));

	it("covers every sender state, authentication result, and text outcome", () => {
		expect(vectors.length).toBeGreaterThan(1500);
	});

	it.each(vectors.map((vector, index) => [index, vector] as const))(
		"vector %i",
		(_index, vector) => {
			const sender =
				vector.sender === null
					? null
					: {
							id: id("sender"),
							status: vector.sender.status,
							lastAcceptedAt: vector.sender.lastAcceptedAt,
							rejectionsInLastDay: vector.sender.rejectionsInLastDay,
						};
			const text =
				vector.text === "ok"
					? ({ ok: true, text: "Hellooo? Anybody there?" } as const)
					: ({
							ok: false,
							problem: vector.text.problem as LetterTextProblem,
						} as const);
			expect(
				decideIntake({ sender, dmarc: vector.dmarc, now: vector.now, text }),
			).toEqual(vector.decision);
		},
	);
});

const CapVectors = z.object({
	weeklyCap: z.array(
		z.object({
			lastAcceptedAt: Instant.nullable(),
			now: Instant,
			allowed: z.boolean(),
			nextAllowedAt: Int.nullable(),
		}),
	),
	rejectionsRemaining: z.array(
		z.object({ rejectionsInLastDay: Int, remaining: Int }),
	),
});

describe("the weekly cap agrees with the proved model", () => {
	const vectors = CapVectors.parse(JSON.parse(capVectors));

	it("decides the cap and names the next allowed time as the model does", () => {
		for (const vector of vectors.weeklyCap) {
			const check = weeklyCap(vector.lastAcceptedAt, vector.now);
			expect(check.allowed).toBe(vector.allowed);
			expect(check.allowed ? null : check.nextAllowedAt).toBe(
				vector.nextAllowedAt,
			);
		}
	});

	it("counts the remaining rejections as the model does", () => {
		for (const vector of vectors.rejectionsRemaining) {
			expect(rejectionsRemaining(vector.rejectionsInLastDay)).toBe(
				vector.remaining,
			);
		}
	});
});

const questions = Object.keys(
	MODERATION_QUESTIONS,
) as (keyof typeof MODERATION_QUESTIONS)[];
const Probabilities = z.object(
	Object.fromEntries(
		questions.map((question) => [question, z.number()]),
	) as Record<keyof typeof MODERATION_QUESTIONS, z.ZodNumber>,
);
const ModerationVector = z.object({
	probabilities: Probabilities,
	verdict: z.enum(["deliver", "reject"]),
});

describe("the moderation verdict agrees with the proved model at and around the threshold", () => {
	const vectors = z
		.array(ModerationVector)
		.parse(JSON.parse(moderationVectors));

	it("covers every question alone and every pair of questions", () => {
		expect(vectors.length).toBeGreaterThan(300);
	});

	it("gives the model's verdict for every vector", () => {
		for (const vector of vectors) {
			expect(verdictFromProbabilities(vector.probabilities)).toBe(
				vector.verdict,
			);
		}
	});
});

const OriginVector = z.object({
	envelopeFrom: Address,
	headerFrom: Address.nullable(),
	ownAddresses: z.array(Address),
	headers: z.array(z.object({ key: z.string(), value: z.string() })),
	problem: z
		.enum([
			"own-address",
			"misaligned-from",
			"auto-submitted",
			"mailing-list",
			"bulk",
		])
		.nullable(),
});

describe("the mail origin check agrees with the proved model", () => {
	const vectors = z.array(OriginVector).parse(JSON.parse(originVectors));

	it("covers every combination of alignment, own address, and watched headers", () => {
		expect(vectors.length).toBe(768);
	});

	it("names the model's problem for every vector", () => {
		for (const vector of vectors) {
			expect(originProblem(vector)).toBe(vector.problem);
		}
	});
});

const RecipientVector = z.object({
	candidates: z.array(
		z.object({
			id: z.string().transform(id),
			status: Status,
			credits: Int,
			receivedFromSender: z.boolean(),
		}),
	),
	senderId: z.string().transform(id),
	numerator: Int,
	denominator: Int,
	eligible: z.array(z.string()),
	chosen: z.string().nullable(),
});

describe("recipient selection agrees with the proved model", () => {
	const vectors = z.array(RecipientVector).parse(JSON.parse(recipientVectors));

	it("covers every subset of the roster and eight dyadic uniforms", () => {
		expect(vectors.length).toBe(1024);
	});

	it("filters and picks as the model does", () => {
		for (const vector of vectors) {
			expect(
				eligibleRecipients(vector.candidates, vector.senderId).map((c) => c.id),
			).toEqual(vector.eligible);
			const u = must(unitInterval(vector.numerator / vector.denominator));
			expect(
				selectRecipient(vector.candidates, vector.senderId, u)?.id ?? null,
			).toBe(vector.chosen);
		}
	});
});

describe("the journey clamp agrees with the proved model", () => {
	const vectors = z
		.array(z.object({ duration: Int, clamped: Int }))
		.parse(JSON.parse(journeyVectors));

	it("clamps every boundary value as the model does", () => {
		for (const vector of vectors) {
			expect(clampJourney(vector.duration)).toBe(vector.clamped);
		}
	});
});

const LedgerVector = z.object({
	steps: z.array(
		z.object({
			kind: z.enum(["accepted", "delivered", "undone"]),
			who: z.string(),
			refused: z.boolean(),
		}),
	),
	credits: z.record(z.string(), Int),
	accepted: Int,
	delivered: Int,
});

describe("the credit ledger agrees with the proved model over generated histories", () => {
	const vectors = z.array(LedgerVector).parse(JSON.parse(creditLedgerVectors));

	it("replays sixty histories", () => {
		expect(vectors).toHaveLength(60);
	});

	it("ends every history in the model's state, refusing the same deliveries", () => {
		for (const vector of vectors) {
			let ledger: Ledger = emptyLedger;
			for (const step of vector.steps) {
				if (step.kind === "accepted") {
					ledger = recordAccepted(ledger, id(step.who));
					continue;
				}
				const next =
					step.kind === "delivered"
						? recordDelivered(ledger, id(step.who))
						: recordUndone(ledger, id(step.who));
				expect(next === null).toBe(step.refused);
				ledger = next ?? ledger;
			}
			for (const [who, held] of Object.entries(vector.credits)) {
				expect(creditsOf(ledger, id(who))).toBe(held);
			}
			expect(ledger.accepted).toBe(vector.accepted);
			expect(ledger.delivered).toBe(vector.delivered);
		}
	});
});

const YouPageVector = z.object({
	status: Status,
	view: z.enum(["waiting", "receiving", "stopped"]),
	controls: z.boolean(),
});

describe("the page about an address agrees with the proved model over every status", () => {
	const vectors = z.array(YouPageVector).parse(JSON.parse(youPageVectors));

	it("covers every status once", () => {
		expect(vectors.map((vector) => vector.status).sort()).toEqual(
			[...USER_STATUSES].sort(),
		);
	});

	it("shows the model's view and offers the controls exactly when the model does", () => {
		for (const vector of vectors) {
			expect(youView(vector.status)).toBe(vector.view);
			expect(youControls(vector.status)).toBe(vector.controls);
		}
	});
});

const ErasureVector = z.object({
	status: z.enum(LETTER_STATUSES),
	settledAt: Instant,
	openReports: Int,
	erased: z.boolean(),
	now: Instant,
	erase: z.boolean(),
});

describe("erasure agrees with the proved model around the end of the retention period", () => {
	const vectors = z.array(ErasureVector).parse(JSON.parse(erasureVectors));

	it("covers every status, both erased states, zero or one report, and four instants", () => {
		expect(vectors).toHaveLength(LETTER_STATUSES.length * 2 * 2 * 4);
	});

	it("erases exactly when the model does", () => {
		for (const vector of vectors) {
			expect(eraseBody(vector, vector.now)).toBe(vector.erase);
		}
	});
});
