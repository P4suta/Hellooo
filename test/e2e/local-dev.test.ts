import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { inHtml, web } from "../support/copy.ts";
import { must } from "../support/must.ts";
import {
	DEV_ORIGIN,
	LOCAL_DATABASE_ID,
	SELLING_MARKER,
	STUB_ORIGIN,
} from "./global-setup.ts";

const HTTP_OK = 200;
const HTTP_SEE_OTHER = 303;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const WRITER = "writer@example.com";
const KAKITE = "kakite@example.jp";
const FORM = { "content-type": "application/x-www-form-urlencoded" };
/** The address to write to, read from the front page the Worker serves, so the test follows the configuration. */
let letters = "";

type Row = (string | number | null)[];

async function sql(statement: string): Promise<Row[]> {
	const response = await fetch(
		`${DEV_ORIGIN}/cdn-cgi/local/explorer/api/d1/database/${LOCAL_DATABASE_ID}/raw`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ sql: statement }),
		},
	);
	expect(response.status).toBe(HTTP_OK);
	const payload = (await response.json()) as {
		result: { results: { rows: Row[] } }[];
	};
	return payload.result[0]?.results.rows ?? [];
}

async function deliver(
	raw: string,
	from: string,
	to = letters,
): Promise<Response> {
	const url = new URL("/cdn-cgi/local/email", DEV_ORIGIN);
	url.searchParams.set("from", from);
	url.searchParams.set("to", to);
	return fetch(url, {
		method: "POST",
		headers: { "content-type": "message/rfc822" },
		body: raw,
	});
}

async function fixture(name: string): Promise<string> {
	return readFile(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
}

async function runScheduled(): Promise<void> {
	const response = await fetch(
		`${DEV_ORIGIN}/cdn-cgi/local/explorer/api/local/scheduled?worker=hellooo`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ cron: "*/15 * * * *" }),
		},
	);
	expect(response.ok).toBe(true);
}

async function cell(statement: string): Promise<string | number | null> {
	const rows = await sql(statement);
	return rows[0]?.[0] ?? null;
}

async function operatorToken(): Promise<string> {
	const response = await fetch(`${STUB_ORIGIN}/e2e/access-token`, {
		method: "POST",
	});
	expect(response.status).toBe(HTTP_OK);
	return response.text();
}

beforeAll(async () => {
	const front = await (await fetch(`${DEV_ORIGIN}/`)).text();
	letters = must(/mailto:([^"]+)"/.exec(front)?.[1], "letters address");
	await sql("DELETE FROM events");
	await sql("DELETE FROM deliveries");
	await sql("DELETE FROM letters");
	await sql("DELETE FROM users");
});

describe("the Worker running under cf dev", () => {
	it("serves the front page in the browser's language", async () => {
		const english = await fetch(`${DEV_ORIGIN}/`);
		expect(english.status).toBe(HTTP_OK);
		expect(await english.text()).toContain(inHtml(web("en").front.anybody));
		const japanese = await fetch(`${DEV_ORIGIN}/`, {
			headers: { "accept-language": "ja" },
		});
		expect(await japanese.text()).toContain(inHtml(web("ja").front.anybody));
	});

	it("takes two strangers from their first mail to a delivered letter, a report, a language switch, and a goodbye", async () => {
		expect(
			(await deliver(await fixture("letter-with-dmarc-pass.eml"), WRITER))
				.status,
		).toBe(HTTP_OK);
		expect(
			await cell(`SELECT status FROM users WHERE email = '${WRITER}'`),
		).toBe("pending");
		expect(await cell("SELECT status FROM letters")).toBe(
			"pending_verification",
		);

		const verifyToken = await cell(
			`SELECT verify_token FROM users WHERE email = '${WRITER}'`,
		);
		const verified = await fetch(`${DEV_ORIGIN}/verify/${verifyToken}`, {
			headers: { "accept-language": "ja" },
		});
		expect(verified.status).toBe(HTTP_OK);
		expect(verified.headers.get("content-language")).toBe("en");
		expect(await verified.text()).toContain(
			inHtml(web("en").verify.confirmed.traveling),
		);
		expect(
			await cell(`SELECT status FROM users WHERE email = '${WRITER}'`),
		).toBe("active");
		expect(
			await cell(`SELECT credits FROM users WHERE email = '${WRITER}'`),
		).toBe(1);

		expect(
			(await deliver(await fixture("letter-in-japanese.eml"), KAKITE)).status,
		).toBe(HTTP_OK);
		const kakiteToken = await cell(
			`SELECT verify_token FROM users WHERE email = '${KAKITE}'`,
		);
		const kakiteVerified = await fetch(`${DEV_ORIGIN}/verify/${kakiteToken}`);
		expect(kakiteVerified.headers.get("content-language")).toBe("ja");
		expect(await kakiteVerified.text()).toContain(
			inHtml(web("ja").verify.confirmed.traveling),
		);
		expect(
			await cell(`SELECT locale FROM users WHERE email = '${KAKITE}'`),
		).toBe("ja");

		await runScheduled();
		expect(await cell("SELECT COUNT(*) FROM deliveries")).toBe(0);

		await sql(
			"UPDATE letters SET deliver_after = 0 WHERE status = 'traveling'",
		);
		await runScheduled();
		expect(await cell("SELECT COUNT(*) FROM deliveries")).toBe(2);
		expect(
			await cell("SELECT COUNT(*) FROM letters WHERE status = 'delivered'"),
		).toBe(2);
		expect(await cell("SELECT SUM(credits) FROM users")).toBe(0);
		expect(
			await cell("SELECT COUNT(*) FROM events WHERE kind = 'letter_delivered'"),
		).toBe(2);

		const reportToken = await cell(
			"SELECT report_token FROM deliveries LIMIT 1",
		);
		const reported = await fetch(`${DEV_ORIGIN}/report/${reportToken}`);
		expect(reported.status).toBe(HTTP_OK);
		expect(
			await cell("SELECT COUNT(*) FROM events WHERE kind = 'letter_reported'"),
		).toBe(1);

		const pageKey = await cell(
			`SELECT page_key FROM users WHERE email = '${KAKITE}'`,
		);
		const page = await fetch(`${DEV_ORIGIN}/you/${pageKey}`);
		expect(page.status).toBe(HTTP_OK);
		expect(page.headers.get("content-language")).toBe("ja");
		const shown = await page.text();
		expect(shown).toContain(`<h1>${KAKITE}</h1>`);
		expect(shown).toContain(inHtml(web("ja").you.receiving));

		const switched = await fetch(`${DEV_ORIGIN}/you/${pageKey}`, {
			method: "POST",
			headers: FORM,
			body: "lang=en",
		});
		expect(switched.status).toBe(HTTP_OK);
		expect(switched.headers.get("content-language")).toBe("en");
		expect(
			await cell(`SELECT locale FROM users WHERE email = '${KAKITE}'`),
		).toBe("en");

		const stopped = await fetch(`${DEV_ORIGIN}/stop/${pageKey}`, {
			method: "POST",
		});
		expect(stopped.status).toBe(HTTP_OK);
		expect(await stopped.text()).toContain(inHtml(web("en").you.farewell));
		expect(
			await cell(`SELECT status FROM users WHERE email = '${KAKITE}'`),
		).toBe("unsubscribed");
	});

	it("refuses a letter the decision model judges as selling", async () => {
		const raw = (await fixture("letter-with-dmarc-pass.eml")).replace(
			"Hellooo? Anybody there?",
			`${SELLING_MARKER} buy my course`,
		);
		await sql(
			`UPDATE letters SET accepted_at = accepted_at - 8 * 86400000 WHERE sender_id = (SELECT id FROM users WHERE email = '${WRITER}')`,
		);
		expect((await deliver(raw, WRITER)).status).toBe(HTTP_OK);
		expect(
			await cell("SELECT status FROM letters ORDER BY created_at DESC LIMIT 1"),
		).toBe("rejected");
		expect(
			await cell("SELECT COUNT(*) FROM events WHERE kind = 'letter_rejected'"),
		).toBe(1);
	});

	it("keeps a letter while the decision model is down and sends it on its way once the model answers", async () => {
		const raw = (await fixture("letter-with-dmarc-pass.eml")).replace(
			"Hellooo? Anybody there?",
			"Is anybody reading this while the model is away?",
		);
		await sql(
			`UPDATE letters SET accepted_at = accepted_at - 8 * 86400000 WHERE sender_id = (SELECT id FROM users WHERE email = '${WRITER}')`,
		);
		const creditsBefore = await cell(
			`SELECT credits FROM users WHERE email = '${WRITER}'`,
		);
		expect(
			(await fetch(`${STUB_ORIGIN}/e2e/model-down`, { method: "POST" })).status,
		).toBe(HTTP_OK);
		expect((await deliver(raw, WRITER)).status).toBe(HTTP_OK);
		expect(
			await cell("SELECT status FROM letters ORDER BY created_at DESC LIMIT 1"),
		).toBe("held");

		await runScheduled();
		expect(
			await cell("SELECT status FROM letters ORDER BY created_at DESC LIMIT 1"),
		).toBe("held");

		expect(
			(await fetch(`${STUB_ORIGIN}/e2e/model-up`, { method: "POST" })).status,
		).toBe(HTTP_OK);
		await runScheduled();
		expect(
			await cell("SELECT status FROM letters ORDER BY created_at DESC LIMIT 1"),
		).toBe("traveling");
		expect(
			await cell(`SELECT credits FROM users WHERE email = '${WRITER}'`),
		).toBe(Number(creditsBefore) + 1);
	});

	it("shows the operator, signed in through Access, the reported letter and lets them close it", async () => {
		expect((await fetch(`${DEV_ORIGIN}/admin`)).status).toBe(HTTP_UNAUTHORIZED);
		const operator = { "cf-access-jwt-assertion": await operatorToken() };
		const queue = await fetch(`${DEV_ORIGIN}/admin`, { headers: operator });
		expect(queue.status).toBe(HTTP_OK);
		const listed = await queue.text();
		expect(listed).toContain(inHtml(web("en").operator.reports("1")));
		const action = must(
			/formaction="(\/admin\/letters\/[^"]+\/close)"/.exec(listed)?.[1],
			"close action",
		);
		const closed = await fetch(`${DEV_ORIGIN}${action}`, {
			method: "POST",
			headers: operator,
			redirect: "manual",
		});
		expect(closed.status).toBe(HTTP_SEE_OTHER);
		expect(closed.headers.get("location")).toBe("/admin");
		const after = await (
			await fetch(`${DEV_ORIGIN}/admin`, { headers: operator })
		).text();
		expect(after).toContain(inHtml(web("en").operator.nothingReported));
		expect(
			await cell("SELECT COUNT(*) FROM events WHERE kind = 'report_closed'"),
		).toBe(1);
	});

	it("stays silent for a stranger without a mail signature", async () => {
		const before = await cell("SELECT COUNT(*) FROM users");
		expect(
			(
				await deliver(
					await fixture("letter-without-authentication.eml"),
					"somebody@example.net",
				)
			).status,
		).toBe(HTTP_OK);
		expect(await cell("SELECT COUNT(*) FROM users")).toBe(before);
		expect(
			await cell("SELECT COUNT(*) FROM events WHERE kind = 'mail_ignored'"),
		).toBeGreaterThan(0);
	});

	it("answers 404 for an unknown key and an unknown page", async () => {
		expect((await fetch(`${DEV_ORIGIN}/verify/nope`)).status).toBe(
			HTTP_NOT_FOUND,
		);
		expect((await fetch(`${DEV_ORIGIN}/you/nope`)).status).toBe(HTTP_NOT_FOUND);
		const nowhere = await fetch(`${DEV_ORIGIN}/nowhere`);
		expect(nowhere.status).toBe(HTTP_NOT_FOUND);
		expect(await nowhere.text()).toContain(inHtml(web("en").unknown.title));
	});
});
