import {
	createExecutionContext,
	createScheduledController,
	waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { DAY_MS } from "../../src/core/duration.ts";
import { BODY_RETENTION_MS } from "../../src/core/erasure.ts";
import { JOURNEY_MAX_MS } from "../../src/core/journey-schedule.ts";
import { addMillis } from "../../src/core/types.ts";
import { createWorker } from "../../src/worker/index.ts";
import { findUserByEmail } from "../../src/worker/repository.ts";
import inJapanese from "../fixtures/letter-in-japanese.eml?raw";
import withDmarcPass from "../fixtures/letter-with-dmarc-pass.eml?raw";
import withoutAuthentication from "../fixtures/letter-without-authentication.eml?raw";
import { inHtml, mailSubject, web } from "../support/copy.ts";
import { must } from "../support/must.ts";
import { useEmptyStorage } from "./d1.ts";
import {
	address,
	CONFIG,
	creditsOf,
	eventKinds,
	type FakePorts,
	fakeMessage,
	fakePorts,
	letterBodies,
	letterStatuses,
	T0,
} from "./fakes.ts";
import { rawMail } from "./raw-mail.ts";

useEmptyStorage();

const HTTP_OK = 200;
const _HTTP_SEE_OTHER = 303;
const LETTERS = CONFIG.LETTERS_ADDRESS;
const WRITER = "writer@example.com";
const KAKITE = "kakite@example.jp";
const FORM = { "content-type": "application/x-www-form-urlencoded" };

/** The first link into the Worker's own page at `path`, as the mail text carries it. */
function linkIn(text: string | undefined, path: string): string {
	const prefix = `${CONFIG.PUBLIC_BASE_URL}/${path}/`;
	const start = (text ?? "").indexOf(prefix);
	const rest = start === -1 ? "" : (text ?? "").slice(start);
	return must(/^\S+/.exec(rest)?.[0], `${path} link`);
}

async function get(
	worker: ReturnType<typeof createWorker>,
	url: string,
	init: RequestInit = {},
): Promise<Response> {
	const ctx = createExecutionContext();
	const response = await worker.fetch(new Request(url, init), env, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}

async function mail(
	worker: ReturnType<typeof createWorker>,
	raw: string,
	from: string,
): Promise<ReturnType<typeof fakeMessage>> {
	const message = fakeMessage(raw, from, LETTERS);
	const ctx = createExecutionContext();
	await worker.email(message, env, ctx);
	await waitOnExecutionContext(ctx);
	return message;
}

async function tick(worker: ReturnType<typeof createWorker>): Promise<void> {
	const ctx = createExecutionContext();
	worker.scheduled(
		createScheduledController({ cron: "*/15 * * * *" }),
		env,
		ctx,
	);
	await waitOnExecutionContext(ctx);
}

async function register(
	worker: ReturnType<typeof createWorker>,
	raw: string,
	from: string,
): Promise<void> {
	const message = await mail(worker, raw, from);
	const verify = linkIn(must(message.replies[0]).text, "verify");
	const page = await get(worker, verify);
	expect(page.status).toBe(HTTP_OK);
	expect(must(await findUserByEmail(env.DB, address(from))).status).toBe(
		"active",
	);
}

describe("two strangers exchange letters", () => {
	it("register by mail, receive each other's letter after the journey, and can report, switch language, or stop", async () => {
		const ports: FakePorts = fakePorts();
		const worker = createWorker(() => ports);

		await register(worker, withDmarcPass, WRITER);
		await register(worker, inJapanese, KAKITE);
		const writer = must(await findUserByEmail(env.DB, address(WRITER)));
		const kakite = must(await findUserByEmail(env.DB, address(KAKITE)));
		expect(writer.locale).toBe("en");
		expect(kakite.locale).toBe("ja");
		expect(await letterStatuses()).toEqual(["traveling", "traveling"]);
		expect(await creditsOf(writer)).toBe(1);
		expect(await creditsOf(kakite)).toBe(1);

		await tick(worker);
		expect(ports.sent).toHaveLength(0);

		ports.clock = addMillis(T0, JOURNEY_MAX_MS + DAY_MS);
		await tick(worker);
		expect(await letterStatuses()).toEqual(["delivered", "delivered"]);
		expect(ports.sent).toHaveLength(2);
		const toWriter = must(ports.sent.find((m) => m.to === WRITER));
		const toKakite = must(ports.sent.find((m) => m.to === KAKITE));
		expect(toWriter.mail.subject).toBe(
			mailSubject(CONFIG.SERVICE_NAME, "en", (m) => m.delivery),
		);
		expect(toWriter.mail.text.startsWith("お～い、だれかいる～？")).toBe(true);
		expect(toKakite.mail.subject).toBe(
			mailSubject(CONFIG.SERVICE_NAME, "ja", (m) => m.delivery),
		);
		expect(toKakite.mail.text.startsWith("Hellooo? Anybody there?")).toBe(true);
		expect(await creditsOf(writer)).toBe(0);
		expect(await creditsOf(kakite)).toBe(0);

		const report = await get(worker, linkIn(toWriter.mail.text, "report"));
		expect(report.status).toBe(HTTP_OK);
		expect(await report.text()).toContain(
			inHtml(web("en").report.thanks.title),
		);
		expect(await eventKinds()).toContain("letter_reported");

		const you = linkIn(toKakite.mail.text, "you");
		const page = await get(worker, you);
		expect(page.status).toBe(HTTP_OK);
		const shown = await page.text();
		expect(shown).toContain(`<h1>${KAKITE}</h1>`);
		expect(shown).toContain(inHtml(web("ja").you.receiving));

		const switched = await get(worker, you, {
			method: "POST",
			headers: FORM,
			body: "lang=en",
		});
		expect(switched.status).toBe(HTTP_OK);
		expect(await switched.text()).toContain(inHtml(web("en").you.receiving));
		expect(must(await findUserByEmail(env.DB, address(KAKITE))).locale).toBe(
			"en",
		);

		const stop = await get(worker, you.replace("/you/", "/stop/"), {
			method: "POST",
		});
		expect(stop.status).toBe(HTTP_OK);
		expect(await stop.text()).toContain(inHtml(web("en").you.farewell));
		expect(must(await findUserByEmail(env.DB, address(KAKITE))).status).toBe(
			"unsubscribed",
		);

		const afterStop = await mail(worker, inJapanese, KAKITE);
		expect(afterStop.replies).toHaveLength(0);

		const again = await mail(worker, withDmarcPass, WRITER);
		expect(must(again.replies[0]).subject).toBe(
			mailSubject(CONFIG.SERVICE_NAME, "en", (m) => m.accepted),
		);
		expect(linkIn(must(again.replies[0]).text, "you")).toBe(
			linkIn(toWriter.mail.text, "you"),
		);
		expect(await creditsOf(writer)).toBe(1);

		const tooSoon = await mail(worker, withDmarcPass, WRITER);
		expect(must(tooSoon.replies[0]).subject).toBe(
			mailSubject(CONFIG.SERVICE_NAME, "en", (m) => m.overCap),
		);
		expect(await creditsOf(writer)).toBe(1);

		ports.clock = addMillis(ports.clock, 8 * DAY_MS);
		const later = await mail(worker, withDmarcPass, WRITER);
		expect(must(later.replies[0]).subject).toBe(
			mailSubject(CONFIG.SERVICE_NAME, "en", (m) => m.accepted),
		);
		expect(await creditsOf(writer)).toBe(2);

		ports.clock = addMillis(ports.clock, JOURNEY_MAX_MS + DAY_MS);
		await tick(worker);
		expect(await letterStatuses()).toEqual([
			"delivered",
			"delivered",
			"traveling",
			"traveling",
		]);
		expect(ports.sent).toHaveLength(2);
	});
});

describe("the text of a delivered letter", () => {
	it("stays for a season and then goes, except while a report on it is open", async () => {
		const ports: FakePorts = fakePorts();
		const worker = createWorker(() => ports);
		await register(worker, withDmarcPass, WRITER);
		await register(worker, inJapanese, KAKITE);
		ports.clock = addMillis(T0, JOURNEY_MAX_MS + DAY_MS);
		await tick(worker);
		expect(await letterStatuses()).toEqual(["delivered", "delivered"]);
		const toWriter = must(ports.sent.find((m) => m.to === WRITER));
		await get(worker, linkIn(toWriter.mail.text, "report"));

		ports.clock = addMillis(ports.clock, BODY_RETENTION_MS);
		await tick(worker);
		const bodies = await letterBodies();
		expect(bodies.filter((body) => body === "")).toHaveLength(1);
		expect(bodies.some((body) => body.startsWith("お～い"))).toBe(true);
		expect(await letterStatuses()).toEqual(["delivered", "delivered"]);
		expect(await eventKinds()).toContain("letter_erased");
	});
});

describe("a registered writer without a mail signature", () => {
	it("confirms the letter through the link in the confirmation mail", async () => {
		const ports: FakePorts = fakePorts();
		const worker = createWorker(() => ports);
		await register(worker, withDmarcPass, WRITER);
		ports.clock = addMillis(T0, 8 * DAY_MS);

		const unsigned = await mail(
			worker,
			rawMail({
				from: WRITER,
				body: "No signature this time.",
				dmarc: "absent",
			}),
			WRITER,
		);
		expect(unsigned.replies).toHaveLength(0);
		expect(ports.sent).toHaveLength(1);
		expect(ports.sent[0]?.mail.subject).toBe(
			mailSubject(CONFIG.SERVICE_NAME, "en", (m) => m.confirmation),
		);
		expect(await letterStatuses()).toEqual([
			"traveling",
			"pending_confirmation",
		]);

		const confirm = await get(
			worker,
			linkIn(must(ports.sent[0]).mail.text, "confirm"),
		);
		expect(confirm.status).toBe(HTTP_OK);
		expect(await confirm.text()).toContain(
			inHtml(web("en").confirm.confirmed.traveling),
		);
		expect(await letterStatuses()).toEqual(["traveling", "traveling"]);
		expect(ports.moderated).toEqual([
			"Hellooo? Anybody there?\n\nIt is raining here today.",
			"No signature this time.",
		]);
	});

	it("never hears back when the stranger's mail has no signature either", async () => {
		const ports: FakePorts = fakePorts();
		const worker = createWorker(() => ports);
		const message = await mail(
			worker,
			withoutAuthentication,
			"somebody@example.net",
		);
		expect(message.replies).toHaveLength(0);
		expect(ports.sent).toHaveLength(0);
	});
});

describe("a letter the moderator refuses", () => {
	it("comes back to the writer and earns no credit", async () => {
		const ports: FakePorts = fakePorts({ verdict: "reject" });
		const worker = createWorker(() => ports);
		const first = await mail(worker, withDmarcPass, WRITER);
		const verify = await get(
			worker,
			linkIn(must(first.replies[0]).text, "verify"),
		);
		expect(await verify.text()).toContain(
			inHtml(web("en").verify.confirmed.next(CONFIG.LETTERS_ADDRESS)),
		);
		expect(await letterStatuses()).toEqual(["rejected"]);
		const writer = must(await findUserByEmail(env.DB, address(WRITER)));
		expect(await creditsOf(writer)).toBe(0);
		ports.verdict = "deliver";
		const second = await mail(worker, withDmarcPass, WRITER);
		expect(must(second.replies[0]).subject).toBe(
			mailSubject(CONFIG.SERVICE_NAME, "en", (m) => m.accepted),
		);
		expect(await letterStatuses()).toEqual(["rejected", "traveling"]);
	});
});

describe("a letter the model cannot be asked about", () => {
	it("waits, goes out on a later run once the model answers, and is then delivered", async () => {
		const ports: FakePorts = fakePorts({ verdict: null });
		const worker = createWorker(() => ports);
		const first = await mail(worker, withDmarcPass, WRITER);
		const verify = await get(
			worker,
			linkIn(must(first.replies[0]).text, "verify"),
		);
		expect(await verify.text()).toContain(
			inHtml(web("en").verify.confirmed.traveling),
		);
		expect(await letterStatuses()).toEqual(["held"]);
		const writer = must(await findUserByEmail(env.DB, address(WRITER)));
		expect(await creditsOf(writer)).toBe(0);

		await tick(worker);
		expect(await letterStatuses()).toEqual(["held"]);
		expect(ports.sent).toHaveLength(0);

		ports.verdict = "deliver";
		await tick(worker);
		expect(await letterStatuses()).toEqual(["traveling"]);
		expect(await creditsOf(writer)).toBe(1);
		expect(ports.sent).toHaveLength(0);

		await register(worker, inJapanese, KAKITE);
		ports.clock = addMillis(T0, JOURNEY_MAX_MS + DAY_MS);
		await tick(worker);
		expect(await letterStatuses()).toEqual(["delivered", "delivered"]);
	});

	it("hears of a refusal only when the later answer refuses it", async () => {
		const ports: FakePorts = fakePorts({ verdict: null });
		const worker = createWorker(() => ports);
		await register(worker, withDmarcPass, WRITER);
		expect(await letterStatuses()).toEqual(["held"]);
		ports.verdict = "reject";
		await tick(worker);
		expect(await letterStatuses()).toEqual(["rejected"]);
		expect(ports.sent).toHaveLength(1);
		expect(ports.sent[0]?.to).toBe(WRITER);
		expect(ports.sent[0]?.mail.subject).toBe(
			mailSubject(CONFIG.SERVICE_NAME, "en", (m) => m.cannotTravel),
		);
	});
});
