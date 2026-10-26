import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { LETTER_MAX_CHARS } from "../../src/core/letter-text.ts";
import { LETTER_STATUSES } from "../../src/core/types.ts";
import { handleIncomingEmail } from "../../src/worker/intake.ts";
import { must } from "../support/must.ts";
import { migrationsOf } from "./d1.ts";
import { CONFIG, fakeMessage, fakePorts } from "./fakes.ts";
import { rawMail } from "./raw-mail.ts";

const LETTERS = CONFIG.LETTERS_ADDRESS;

const sender = fc.constantFrom(
	"writer@example.com",
	"Writer@Example.COM",
	"kakite@example.jp",
	"not an address",
	"",
	"a@b",
	`${"x".repeat(70)}@example.com`,
);
const recipient = fc.constantFrom(
	LETTERS,
	LETTERS.toUpperCase(),
	CONFIG.NOTICES_ADDRESS,
	"",
);
const dmarc = fc.constantFrom<"pass" | "fail" | "none" | "absent">(
	"pass",
	"fail",
	"none",
	"absent",
);
const contentType = fc.constantFrom(
	"text/plain; charset=utf-8",
	"text/html; charset=utf-8",
	"application/octet-stream",
	"text/plain",
);
const body = fc.oneof(
	fc.string({ unit: "grapheme", maxLength: 600 }),
	fc.constant(""),
	fc.constant("https://example.com"),
	fc.constant("call 090-1234-5678"),
	fc.constant("<p>html &amp; entities</p>"),
	fc.constant("字".repeat(LETTER_MAX_CHARS + 100)),
	fc.constant("お～い、だれかいる～？"),
);
const extraHeaders = fc.array(
	fc.constantFrom(
		"Content-Language: ja",
		"Content-Language: fr",
		"Authentication-Results: attacker.example; dmarc=pass",
		"X-Mailer: fuzz",
		"Subject: =?UTF-8?B?44GK44CB44GK?=",
	),
	{ maxLength: 3 },
);

describe("the intake under arbitrary mail", () => {
	it("never throws and leaves the database consistent", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.array(
					fc.record({
						sender,
						recipient,
						dmarc,
						contentType,
						body,
						extraHeaders,
					}),
					{ minLength: 1, maxLength: 6 },
				),
				async (mails) => {
					await reset();
					await applyD1Migrations(env.DB, migrationsOf(env));
					const ports = fakePorts();
					for (const mail of mails) {
						const raw = rawMail({
							from: mail.sender,
							to: mail.recipient,
							body: mail.body,
							dmarc: mail.dmarc,
							contentType: mail.contentType,
							extraHeaders: mail.extraHeaders,
						});
						await handleIncomingEmail(
							fakeMessage(raw, mail.sender, mail.recipient),
							env,
							ports,
						);
					}
					const letters = (
						await env.DB.prepare("SELECT body, status FROM letters").all<{
							body: string;
							status: string;
						}>()
					).results;
					for (const letter of letters) {
						expect(LETTER_STATUSES).toContain(letter.status);
						expect([...letter.body].length).toBeLessThanOrEqual(
							LETTER_MAX_CHARS,
						);
						expect(letter.body.trim()).toBe(letter.body);
						expect(letter.body).not.toMatch(/https?:\/\//i);
						expect(letter.body).not.toMatch(/\S+@\S+\.\S+/);
					}
					const users = (
						await env.DB.prepare(
							"SELECT email, credits, locale FROM users",
						).all<{
							email: string;
							credits: number;
							locale: string;
						}>()
					).results;
					for (const user of users) {
						expect(user.email).toBe(user.email.toLowerCase());
						expect(user.credits).toBeGreaterThanOrEqual(0);
						expect(["en", "ja"]).toContain(user.locale);
					}
					const sums = must(
						await env.DB.prepare(
							"SELECT COALESCE(SUM(credits), 0) AS credits, (SELECT COUNT(*) FROM letters WHERE accepted_at IS NOT NULL) AS accepted FROM users",
						).first<{ credits: number; accepted: number }>(),
					);
					expect(sums.credits).toBe(sums.accepted);
					const events = (
						await env.DB.prepare("SELECT detail FROM events").all<{
							detail: string | null;
						}>()
					).results;
					for (const event of events) {
						expect(event.detail ?? "").not.toContain("@");
					}
				},
			),
			{ numRuns: 30 },
		);
	});
});
