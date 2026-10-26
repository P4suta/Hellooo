import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { WEEK_MS } from "../../src/core/duration.ts";
import {
	decideAfterModeration,
	decideIntake,
	type IntakeInput,
	type KnownSender,
} from "../../src/core/intake-decision.ts";
import type { LetterText } from "../../src/core/letter-text.ts";
import {
	DMARC_RESULTS,
	type DmarcResult,
	instant,
	USER_STATUSES,
	type UserStatus,
	userId,
} from "../../src/core/types.ts";
import { DAILY_REJECTION_LIMIT, weeklyCap } from "../../src/core/weekly-cap.ts";
import { must } from "../support/must.ts";

const NOW_MS = 1_800_000_000_000;
const now = must(instant(NOW_MS));
const fineText: LetterText = { ok: true, text: "Hellooo? Anybody there?" };
const badText: LetterText = { ok: false, problem: "url" };

function sender(
	status: UserStatus,
	overrides: Partial<KnownSender> = {},
): KnownSender {
	return {
		id: must(userId("sender")),
		status,
		lastAcceptedAt: null,
		rejectionsInLastDay: 0,
		...overrides,
	};
}

function input(overrides: Partial<IntakeInput>): IntakeInput {
	return { sender: null, dmarc: "pass", now, text: fineText, ...overrides };
}

const anyText = fc.oneof(
	fc.constant(fineText),
	fc.constantFrom<LetterText>(
		{ ok: false, problem: "empty" },
		{ ok: false, problem: "url" },
		{ ok: false, problem: "email-address" },
		{ ok: false, problem: "phone-number" },
	),
);
const anyDmarc = fc.constantFrom<DmarcResult>(...DMARC_RESULTS);
const anySender = fc.record({
	status: fc.constantFrom<UserStatus>(...USER_STATUSES),
	ageMs: fc.option(fc.integer({ min: 0, max: 2 * WEEK_MS }), { nil: null }),
	rejections: fc.integer({ min: 0, max: DAILY_REJECTION_LIMIT + 2 }),
});

function knownSender(shape: {
	status: UserStatus;
	ageMs: number | null;
	rejections: number;
}): KnownSender {
	return sender(shape.status, {
		lastAcceptedAt:
			shape.ageMs === null ? null : must(instant(NOW_MS - shape.ageMs)),
		rejectionsInLastDay: shape.rejections,
	});
}

describe("decideIntake for an unknown sender", () => {
	it("ignores mail that did not pass DMARC", () => {
		expect(decideIntake(input({ dmarc: "fail" }))).toEqual({
			kind: "ignore",
			reason: "unauthenticated-unknown-sender",
		});
		expect(decideIntake(input({ dmarc: "none" }))).toEqual({
			kind: "ignore",
			reason: "unauthenticated-unknown-sender",
		});
	});

	it("registers an authenticated stranger and keeps a sound letter", () => {
		expect(decideIntake(input({}))).toEqual({
			kind: "register",
			storeLetter: true,
		});
		expect(decideIntake(input({ text: badText }))).toEqual({
			kind: "register",
			storeLetter: false,
		});
	});

	it("never replies to an unauthenticated stranger whatever they wrote", () => {
		fc.assert(
			fc.property(
				anyText,
				fc.constantFrom<DmarcResult>("fail", "none"),
				(letter, result) =>
					decideIntake(input({ text: letter, dmarc: result })).kind ===
					"ignore",
			),
		);
	});

	it("always registers an authenticated stranger, storing the letter exactly when it is sound", () => {
		fc.assert(
			fc.property(anyText, (letter) => {
				const decision = decideIntake(input({ text: letter }));
				return (
					decision.kind === "register" && decision.storeLetter === letter.ok
				);
			}),
		);
	});
});

describe("decideIntake for a pending sender", () => {
	it("re-sends the verification on authenticated mail and stays silent otherwise", () => {
		expect(decideIntake(input({ sender: sender("pending") }))).toEqual({
			kind: "register",
			storeLetter: true,
		});
		expect(
			decideIntake(input({ sender: sender("pending"), dmarc: "fail" })),
		).toEqual({ kind: "ignore", reason: "unauthenticated-unknown-sender" });
	});

	it("treats a pending sender like a stranger whatever their history", () => {
		fc.assert(
			fc.property(anySender, anyText, anyDmarc, (shape, letter, dmarc) => {
				const pending = knownSender({ ...shape, status: "pending" });
				const asKnown = decideIntake(
					input({ sender: pending, text: letter, dmarc }),
				);
				const asStranger = decideIntake(
					input({ sender: null, text: letter, dmarc }),
				);
				return JSON.stringify(asKnown) === JSON.stringify(asStranger);
			}),
		);
	});
});

describe("decideIntake for an active authenticated sender", () => {
	it("sends a sound letter to moderation", () => {
		expect(decideIntake(input({ sender: sender("active") }))).toEqual({
			kind: "moderate",
		});
	});

	it("refuses a second letter inside the week", () => {
		const last = must(instant(NOW_MS - WEEK_MS + 1));
		expect(
			decideIntake(
				input({ sender: sender("active", { lastAcceptedAt: last }) }),
			),
		).toEqual({ kind: "over-cap", nextAllowedAt: last + WEEK_MS });
	});

	it("allows a letter exactly one week after the last", () => {
		const last = must(instant(NOW_MS - WEEK_MS));
		expect(
			decideIntake(
				input({ sender: sender("active", { lastAcceptedAt: last }) }),
			),
		).toEqual({ kind: "moderate" });
	});

	it("stops moderating after the daily rejection limit", () => {
		expect(
			decideIntake(
				input({
					sender: sender("active", {
						rejectionsInLastDay: DAILY_REJECTION_LIMIT,
					}),
				}),
			),
		).toEqual({ kind: "rejections-exhausted" });
		expect(
			decideIntake(
				input({
					sender: sender("active", {
						rejectionsInLastDay: DAILY_REJECTION_LIMIT - 1,
					}),
				}),
			),
		).toEqual({ kind: "moderate" });
	});

	it("rejects a letter with a URL before moderation", () => {
		expect(
			decideIntake(input({ sender: sender("active"), text: badText })),
		).toEqual({ kind: "reject-text", problem: "url" });
	});

	it("checks the cap, then the rejection limit, then the text, then moderates", () => {
		fc.assert(
			fc.property(anySender, anyText, (shape, letter) => {
				const active = knownSender({ ...shape, status: "active" });
				const decision = decideIntake(input({ sender: active, text: letter }));
				const cap = weeklyCap(active.lastAcceptedAt, now);
				if (!cap.allowed) {
					return (
						decision.kind === "over-cap" &&
						decision.nextAllowedAt === cap.nextAllowedAt
					);
				}
				if (active.rejectionsInLastDay >= DAILY_REJECTION_LIMIT) {
					return decision.kind === "rejections-exhausted";
				}
				if (!letter.ok) {
					return (
						decision.kind === "reject-text" &&
						decision.problem === letter.problem
					);
				}
				return decision.kind === "moderate";
			}),
		);
	});
});

describe("decideIntake for an active sender without DMARC", () => {
	it("asks for confirmation when the letter is sound and the cap allows", () => {
		expect(
			decideIntake(input({ sender: sender("active"), dmarc: "none" })),
		).toEqual({ kind: "confirm" });
	});

	it("stays silent when the letter would be refused anyway", () => {
		expect(
			decideIntake(
				input({ sender: sender("active"), dmarc: "fail", text: badText }),
			),
		).toEqual({ kind: "ignore", reason: "unauthenticated-sender-blocked" });
		const last = must(instant(NOW_MS - 1));
		expect(
			decideIntake(
				input({
					sender: sender("active", { lastAcceptedAt: last }),
					dmarc: "fail",
				}),
			),
		).toEqual({ kind: "ignore", reason: "unauthenticated-sender-blocked" });
	});

	it("either asks for confirmation or stays silent, never anything else", () => {
		fc.assert(
			fc.property(
				anySender,
				anyText,
				fc.constantFrom<DmarcResult>("fail", "none"),
				(shape, letter, dmarc) => {
					const active = knownSender({ ...shape, status: "active" });
					const decision = decideIntake(
						input({ sender: active, text: letter, dmarc }),
					);
					const allowed =
						weeklyCap(active.lastAcceptedAt, now).allowed && letter.ok;
					return allowed
						? decision.kind === "confirm"
						: decision.kind === "ignore" &&
								decision.reason === "unauthenticated-sender-blocked";
				},
			),
		);
	});
});

describe("decideIntake for an inactive sender", () => {
	it.each<UserStatus>(["unsubscribed", "suppressed", "banned"])(
		"ignores a %s sender",
		(status) => {
			expect(decideIntake(input({ sender: sender(status) }))).toEqual({
				kind: "ignore",
				reason: "sender-inactive",
			});
		},
	);

	it("ignores an inactive sender whatever the mail looks like", () => {
		fc.assert(
			fc.property(
				anySender,
				anyText,
				anyDmarc,
				fc.constantFrom<UserStatus>("unsubscribed", "suppressed", "banned"),
				(shape, letter, dmarc, status) => {
					const inactive = knownSender({ ...shape, status });
					const decision = decideIntake(
						input({ sender: inactive, text: letter, dmarc }),
					);
					return (
						decision.kind === "ignore" && decision.reason === "sender-inactive"
					);
				},
			),
		);
	});
});

describe("decideIntake replies only to authenticated mail", () => {
	it("never produces a reply-bearing decision without a DMARC pass", () => {
		fc.assert(
			fc.property(
				fc.option(anySender, { nil: null }),
				anyText,
				fc.constantFrom<DmarcResult>("fail", "none"),
				(shape, letter, dmarc) => {
					const known = shape === null ? null : knownSender(shape);
					const decision = decideIntake(
						input({ sender: known, text: letter, dmarc }),
					);
					return decision.kind === "ignore" || decision.kind === "confirm";
				},
			),
		);
	});
});

describe("decideAfterModeration", () => {
	it("maps each verdict to one acceptance decision", () => {
		expect(decideAfterModeration("deliver")).toEqual({ kind: "accept" });
		expect(decideAfterModeration("reject")).toEqual({ kind: "reject-content" });
		expect(decideAfterModeration(null)).toEqual({ kind: "retry-later" });
	});
});
