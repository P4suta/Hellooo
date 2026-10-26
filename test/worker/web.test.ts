import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
	type LegalFacts,
	privacyPage,
	RETENTION_DAYS,
	termsPage,
} from "../../src/core/legal.ts";
import { regionName } from "../../src/core/locale.ts";
import { addMillis } from "../../src/core/types.ts";
import { publicPath } from "../../src/worker/env.ts";
import {
	createPendingUser,
	eraseLetters,
	findLetter,
	findUserByEmail,
	reportDelivery,
	reserveDelivery,
	storeLetter,
} from "../../src/worker/repository.ts";
import { createApp } from "../../src/worker/web.ts";
import { inHtml, web } from "../support/copy.ts";
import { must } from "../support/must.ts";
import { useEmptyStorage } from "./d1.ts";
import {
	address,
	CONFIG,
	creditsOf,
	eventKinds,
	fakePorts,
	letterStatuses,
	OPERATOR_TOKEN,
	pageKeyFor,
	seedActiveUser,
	seedHeldLetter,
	seedTravelingLetter,
	T0,
} from "./fakes.ts";

useEmptyStorage();

const HTTP_OK = 200;
const HTTP_SEE_OTHER = 303;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const READER = "reader@example.com";
const WRITER = "writer@example.com";
const FORM = { "content-type": "application/x-www-form-urlencoded" };
const AS_OPERATOR = { "cf-access-jwt-assertion": OPERATOR_TOKEN };
/** The facts of the test Worker, so a legal page's expected title comes from the same catalog the page renders. */
const FACTS: LegalFacts = {
	service: CONFIG.SERVICE_NAME,
	operator: CONFIG.OPERATOR_NAME,
	contact: CONFIG.NOTICES_ADDRESS,
	jurisdiction: CONFIG.LEGAL_JURISDICTION,
};

function post(
	body?: string,
	headers: Record<string, string> = {},
): RequestInit {
	return {
		method: "POST",
		headers: { ...(body === undefined ? {} : FORM), ...headers },
		...(body === undefined ? {} : { body }),
	};
}

describe("the front page", () => {
	it("greets in English by default, in three screens that end with the operator and the contact", async () => {
		const app = createApp(() => fakePorts());
		const response = await app.request("/", {}, env);
		expect(response.status).toBe(HTTP_OK);
		expect(response.headers.get("content-language")).toBe("en");
		expect(response.headers.get("vary")).toBe("Accept-Language");
		const body = await response.text();
		expect(body).toContain('<html lang="en">');
		expect(body).toContain(inHtml(web("en").front.hello));
		expect(body).toContain(inHtml(web("en").front.anybody));
		expect(body).toContain(`mailto:${CONFIG.LETTERS_ADDRESS}`);
		expect(body).toContain(
			inHtml(web("en").front.operated(CONFIG.OPERATOR_NAME)),
		);
		expect(body).toContain(`mailto:${CONFIG.NOTICES_ADDRESS}`);
		expect(body).toContain(`<a href="/terms">${web("en").front.terms}</a>`);
		expect(body).toContain(`<a href="/privacy">${web("en").front.privacy}</a>`);
		expect(body.match(/<section /g)).toHaveLength(3);
		expect(body.match(/class="next"/g)).toHaveLength(2);
		expect(body).toContain('<link rel="icon" href="data:image/svg+xml,');
		expect(body).toContain('<meta name="theme-color"');
		const sentence = web("en").front.write(CONFIG.LETTERS_ADDRESS);
		expect(body).toContain(
			`<meta name="description" content="${inHtml(sentence)}">`,
		);
		const [before = "", after = ""] = sentence.split(CONFIG.LETTERS_ADDRESS);
		expect(body).toContain(
			`<p>${inHtml(before)}<a href="mailto:${CONFIG.LETTERS_ADDRESS}">${CONFIG.LETTERS_ADDRESS}</a>${inHtml(after)}</p>`,
		);
		expect(body).toContain(inHtml(web("en").front.rules));
		expect(body).toContain(inHtml(web("en").front.only));
	});

	it("speaks the browser's language", async () => {
		const app = createApp(() => fakePorts());
		const response = await app.request(
			"/",
			{ headers: { "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8" } },
			env,
		);
		expect(response.headers.get("content-language")).toBe("ja");
		const body = await response.text();
		expect(body).toContain('<html lang="ja">');
		expect(body).toContain(inHtml(web("ja").front.anybody));
	});

	it("lets a link choose the language over the browser", async () => {
		const app = createApp(() => fakePorts());
		const response = await app.request(
			"/?lang=ja",
			{ headers: { "Accept-Language": "en" } },
			env,
		);
		expect(response.headers.get("content-language")).toBe("ja");
		expect(await response.text()).toContain(inHtml(web("ja").front.anybody));
	});

	it("falls back to English for an unknown language", async () => {
		const app = createApp(() => fakePorts());
		const response = await app.request(
			"/?lang=fr",
			{ headers: { "Accept-Language": "de" } },
			env,
		);
		expect(response.headers.get("content-language")).toBe("en");
	});

	it("answers an unknown path with a page that says so, in the visitor's language", async () => {
		const app = createApp(() => fakePorts());
		const response = await app.request(
			"/nowhere",
			{ headers: { "Accept-Language": "ja" } },
			env,
		);
		expect(response.status).toBe(HTTP_NOT_FOUND);
		expect(await response.text()).toContain(inHtml(web("ja").unknown.title));
	});
});

describe("the terms and the privacy notice", () => {
	it("show the configured facts in the visitor's language", async () => {
		const app = createApp(() => fakePorts());
		const terms = await app.request("/terms", {}, env);
		expect(terms.status).toBe(HTTP_OK);
		const termsBody = await terms.text();
		expect(termsBody).toContain(
			`<h1>${inHtml(termsPage("en", FACTS).title)}</h1>`,
		);
		expect(termsBody).toContain(
			inHtml(regionName("en", CONFIG.LEGAL_JURISDICTION)),
		);
		expect(termsBody).toContain(inHtml(CONFIG.NOTICES_ADDRESS));
		const privacy = await app.request(
			"/privacy",
			{ headers: { "Accept-Language": "ja" } },
			env,
		);
		expect(privacy.status).toBe(HTTP_OK);
		const privacyBody = await privacy.text();
		expect(privacyBody).toContain(
			`<h1>${inHtml(privacyPage("ja", FACTS).title)}</h1>`,
		);
		expect(privacyBody).toContain(inHtml(CONFIG.OPERATOR_NAME));
		expect(privacyBody).toContain(String(RETENTION_DAYS));
		expect(privacyBody.match(/<h2>/g)?.length).toBe(
			privacyPage("ja", FACTS).sections.length,
		);
	});
});

describe("verifying an address", () => {
	it("confirms the address and starts the waiting letter", async () => {
		const ports = fakePorts();
		const app = createApp(() => ports);
		const user = await createPendingUser(env.DB, {
			id: ports.newId(),
			email: address(WRITER),
			verifyToken: "verify-1",
			pageKey: "page-1",
			locale: "en",
			now: T0,
		});
		await storeLetter(env.DB, {
			id: ports.newId(),
			senderId: user.id,
			body: "Hellooo?",
			status: "pending_verification",
			now: T0,
		});
		const response = await app.request("/verify/verify-1", post(), env);
		expect(response.status).toBe(HTTP_OK);
		expect(await response.text()).toContain(
			inHtml(web("en").verify.confirmed.traveling),
		);
		expect(await letterStatuses()).toEqual(["traveling"]);
		expect(await creditsOf(user)).toBe(1);
		expect(must(await findUserByEmail(env.DB, user.email)).status).toBe(
			"active",
		);
		expect(ports.moderated).toEqual(["Hellooo?"]);

		const again = await app.request("/verify/verify-1", post(), env);
		expect(again.status).toBe(HTTP_NOT_FOUND);
		expect(await again.text()).toContain(inHtml(web("en").verify.used.title));
	});

	it("answers in the language stored for the address, whatever the browser says", async () => {
		const ports = fakePorts();
		const app = createApp(() => ports);
		await createPendingUser(env.DB, {
			id: ports.newId(),
			email: address(WRITER),
			verifyToken: "verify-1",
			pageKey: "page-1",
			locale: "ja",
			now: T0,
		});
		const asked = await app.request(
			"/verify/verify-1",
			{ headers: { "Accept-Language": "en" } },
			env,
		);
		expect(asked.status).toBe(HTTP_OK);
		expect(asked.headers.get("content-language")).toBe("ja");
		const askedBody = await asked.text();
		expect(askedBody).toContain(
			`<h1>${inHtml(web("ja").verify.ask.title)}</h1>`,
		);
		expect(askedBody).toContain(
			`<form method="post"><p><button>${inHtml(web("ja").verify.ask.button)}</button></p></form>`,
		);
		expect(must(await findUserByEmail(env.DB, address(WRITER))).status).toBe(
			"pending",
		);
		const response = await app.request(
			"/verify/verify-1",
			post(undefined, { "Accept-Language": "en" }),
			env,
		);
		expect(response.status).toBe(HTTP_OK);
		expect(response.headers.get("content-language")).toBe("ja");
		const body = await response.text();
		expect(body).toContain('<html lang="ja">');
		expect(body).toContain(
			inHtml(web("ja").verify.confirmed.next(CONFIG.LETTERS_ADDRESS)),
		);
		expect(ports.moderated).toHaveLength(0);
	});

	it("keeps the waiting letter for a later attempt when the model cannot be asked, and still says it is on its way", async () => {
		const ports = fakePorts({ verdict: null });
		const app = createApp(() => ports);
		const user = await createPendingUser(env.DB, {
			id: ports.newId(),
			email: address(WRITER),
			verifyToken: "verify-1",
			pageKey: "page-1",
			locale: "en",
			now: T0,
		});
		await storeLetter(env.DB, {
			id: ports.newId(),
			senderId: user.id,
			body: "Hellooo?",
			status: "pending_verification",
			now: T0,
		});
		const response = await app.request("/verify/verify-1", post(), env);
		expect(await response.text()).toContain(
			inHtml(web("en").verify.confirmed.traveling),
		);
		expect(await letterStatuses()).toEqual(["held"]);
		expect(await creditsOf(user)).toBe(0);
	});

	it("refuses an unknown key and a link without one", async () => {
		const app = createApp(() => fakePorts());
		expect((await app.request("/verify/nope", {}, env)).status).toBe(
			HTTP_NOT_FOUND,
		);
		expect((await app.request("/verify", {}, env)).status).toBe(HTTP_NOT_FOUND);
		expect((await app.request("/verify/", {}, env)).status).toBe(
			HTTP_NOT_FOUND,
		);
	});
});

describe("confirming a letter", () => {
	it("starts a confirmed letter on its journey, in the writer's language", async () => {
		const ports = fakePorts();
		const app = createApp(() => ports);
		const writer = await seedActiveUser(ports, WRITER, 0, "ja");
		await storeLetter(env.DB, {
			id: ports.newId(),
			senderId: writer.id,
			body: "Hellooo?",
			status: "pending_confirmation",
			confirmToken: "confirm-1",
			now: T0,
		});
		const asked = await app.request("/confirm/confirm-1", {}, env);
		expect(asked.status).toBe(HTTP_OK);
		expect(asked.headers.get("content-language")).toBe("ja");
		const askedBody = await asked.text();
		expect(askedBody).toContain(
			`<h1>${inHtml(web("ja").confirm.ask.title)}</h1>`,
		);
		expect(askedBody).toContain('<pre class="letter">Hellooo?</pre>');
		expect(await letterStatuses()).toEqual(["pending_confirmation"]);
		const response = await app.request("/confirm/confirm-1", post(), env);
		expect(response.status).toBe(HTTP_OK);
		expect(response.headers.get("content-language")).toBe("ja");
		expect(await response.text()).toContain(
			inHtml(web("ja").confirm.confirmed.traveling),
		);
		expect(await letterStatuses()).toEqual(["traveling"]);
		expect(await creditsOf(writer)).toBe(1);
		const again = await app.request("/confirm/confirm-1", post(), env);
		expect(again.status).toBe(HTTP_NOT_FOUND);
		expect(await again.text()).toContain(inHtml(web("en").confirm.used.title));
	});

	it("tells the writer when a confirmed letter cannot travel", async () => {
		const ports = fakePorts({ verdict: "reject" });
		const app = createApp(() => ports);
		const writer = await seedActiveUser(ports, WRITER);
		await storeLetter(env.DB, {
			id: ports.newId(),
			senderId: writer.id,
			body: "Hellooo?",
			status: "pending_confirmation",
			confirmToken: "confirm-1",
			now: T0,
		});
		const response = await app.request("/confirm/confirm-1", post(), env);
		expect(response.status).toBe(HTTP_OK);
		expect(await response.text()).toContain(
			inHtml(web("en").confirm.confirmed.refused),
		);
		expect(await letterStatuses()).toEqual(["rejected"]);
		expect(await creditsOf(writer)).toBe(0);
	});
});

describe("the page about an address", () => {
	it("shows the address, that letters reach it, the language, and the way to stop", async () => {
		const ports = fakePorts();
		const app = createApp(() => ports);
		await seedActiveUser(ports, READER, 1);
		const response = await app.request(
			publicPath("you", pageKeyFor(READER)),
			{ headers: { "Accept-Language": "ja" } },
			env,
		);
		expect(response.status).toBe(HTTP_OK);
		expect(response.headers.get("content-language")).toBe("en");
		const body = await response.text();
		expect(body).toContain(`<h1>${READER}</h1>`);
		expect(body).toContain(inHtml(web("en").you.receiving));
		expect(body).toContain(
			`<button name="lang" value="ja">${inHtml(web("en").you.switchTo.ja)}</button>`,
		);
		expect(body).not.toContain(`value="en"`);
		expect(body).toContain(`<button>${inHtml(web("en").you.stop)}</button>`);
		expect(body).toContain(
			`action="${publicPath("stop", pageKeyFor(READER))}"`,
		);
		expect(body).not.toContain(inHtml(web("en").you.farewell));
	});

	it("tells a pending address that it waits for its confirmation", async () => {
		const ports = fakePorts();
		const app = createApp(() => ports);
		await createPendingUser(env.DB, {
			id: ports.newId(),
			email: address(WRITER),
			verifyToken: "verify-1",
			pageKey: "page-1",
			locale: "en",
			now: T0,
		});
		const body = await (await app.request("/you/page-1", {}, env)).text();
		expect(body).toContain(inHtml(web("en").you.waiting));
		expect(body).toContain("<form");
	});

	it("reads in the stored language and offers the other one", async () => {
		const ports = fakePorts();
		const app = createApp(() => ports);
		await seedActiveUser(ports, READER, 0, "ja");
		const response = await app.request(
			publicPath("you", pageKeyFor(READER)),
			{ headers: { "Accept-Language": "en" } },
			env,
		);
		expect(response.headers.get("content-language")).toBe("ja");
		const body = await response.text();
		expect(body).toContain('<html lang="ja">');
		expect(body).toContain(inHtml(web("ja").you.receiving));
		expect(body).toContain(
			`<button name="lang" value="en">${inHtml(web("ja").you.switchTo.en)}</button>`,
		);
	});

	it("changes the language of the address on a post and ignores an unknown one", async () => {
		const ports = fakePorts();
		const app = createApp(() => ports);
		const reader = await seedActiveUser(ports, READER);
		const path = publicPath("you", pageKeyFor(READER));
		const switched = await app.request(path, post("lang=ja"), env);
		expect(switched.status).toBe(HTTP_OK);
		expect(switched.headers.get("content-language")).toBe("ja");
		expect(await switched.text()).toContain(inHtml(web("ja").you.receiving));
		expect(must(await findUserByEmail(env.DB, reader.email)).locale).toBe("ja");
		const ignored = await app.request(path, post("lang=fr"), env);
		expect(ignored.status).toBe(HTTP_OK);
		expect(must(await findUserByEmail(env.DB, reader.email)).locale).toBe("ja");
		const empty = await app.request(path, post(), env);
		expect(empty.status).toBe(HTTP_OK);
		expect(await eventKinds()).toEqual(["user_verified", "locale_changed"]);
	});

	it("stops letters on a post, says goodbye once, and keeps the state afterwards", async () => {
		const ports = fakePorts();
		const app = createApp(() => ports);
		const reader = await seedActiveUser(ports, READER, 1);
		const stop = publicPath("stop", pageKeyFor(READER));
		const stopped = await app.request(stop, post(), env);
		expect(stopped.status).toBe(HTTP_OK);
		const body = await stopped.text();
		expect(body).toContain(inHtml(web("en").you.stopped));
		expect(body).toContain(inHtml(web("en").you.farewell));
		expect(body).not.toContain("<form");
		expect(must(await findUserByEmail(env.DB, reader.email)).status).toBe(
			"unsubscribed",
		);

		const again = await app.request(stop, post(), env);
		expect(again.status).toBe(HTTP_OK);
		const later = await again.text();
		expect(later).toContain(inHtml(web("en").you.stopped));
		expect(later).not.toContain(inHtml(web("en").you.farewell));

		const page = await app.request(
			publicPath("you", pageKeyFor(READER)),
			{},
			env,
		);
		expect(await page.text()).not.toContain("<form");
		const ignored = await app.request(
			publicPath("you", pageKeyFor(READER)),
			post("lang=ja"),
			env,
		);
		expect(ignored.status).toBe(HTTP_OK);
		expect(must(await findUserByEmail(env.DB, reader.email)).locale).toBe("en");
		expect(await eventKinds()).toEqual(["user_verified", "user_unsubscribed"]);
	});

	it("shows the page, without stopping, when the stop link is merely opened", async () => {
		const ports = fakePorts();
		const app = createApp(() => ports);
		const reader = await seedActiveUser(ports, READER, 1);
		const response = await app.request(
			publicPath("stop", pageKeyFor(READER)),
			{},
			env,
		);
		expect(response.status).toBe(HTTP_OK);
		expect(await response.text()).toContain(inHtml(web("en").you.receiving));
		expect(must(await findUserByEmail(env.DB, reader.email)).status).toBe(
			"active",
		);
	});

	it("stops a pending address as well", async () => {
		const ports = fakePorts();
		const app = createApp(() => ports);
		const user = await createPendingUser(env.DB, {
			id: ports.newId(),
			email: address(WRITER),
			verifyToken: "verify-1",
			pageKey: "page-1",
			locale: "en",
			now: T0,
		});
		await app.request("/stop/page-1", post(), env);
		expect(must(await findUserByEmail(env.DB, user.email)).status).toBe(
			"unsubscribed",
		);
		expect((await app.request("/verify/verify-1", post(), env)).status).toBe(
			HTTP_NOT_FOUND,
		);
	});

	it("answers an unknown key with the unknown page", async () => {
		const app = createApp(() => fakePorts());
		for (const path of ["/you/nope", "/stop/nope"]) {
			const got = await app.request(path, {}, env);
			expect(got.status).toBe(HTTP_NOT_FOUND);
			expect(await got.text()).toContain(inHtml(web("en").unknown.body));
			expect((await app.request(path, post("lang=ja"), env)).status).toBe(
				HTTP_NOT_FOUND,
			);
		}
	});

	it("refuses a post from another origin and accepts one from its own", async () => {
		const ports = fakePorts();
		const app = createApp(() => ports);
		const reader = await seedActiveUser(ports, READER, 1);
		const stop = publicPath("stop", pageKeyFor(READER));
		for (const headers of [
			{ origin: "https://evil.example" },
			{ "sec-fetch-site": "cross-site" },
			{ origin: "http://localhost", "sec-fetch-site": "same-site" },
		]) {
			expect(
				(await app.request(stop, post(undefined, headers), env)).status,
			).toBe(HTTP_FORBIDDEN);
		}
		expect(must(await findUserByEmail(env.DB, reader.email)).status).toBe(
			"active",
		);
		const own = await app.request(
			stop,
			post(undefined, {
				origin: "http://localhost",
				"sec-fetch-site": "same-origin",
			}),
			env,
		);
		expect(own.status).toBe(HTTP_OK);
		expect(must(await findUserByEmail(env.DB, reader.email)).status).toBe(
			"unsubscribed",
		);
	});
});

describe("reporting a letter", () => {
	it("records a report against a delivered letter, in the reader's language, and refuses an unknown key", async () => {
		const ports = fakePorts();
		const app = createApp(() => ports);
		const writer = await seedActiveUser(ports, WRITER);
		const reader = await seedActiveUser(ports, READER, 1, "ja");
		const letter = await seedTravelingLetter(ports, writer, addMillis(T0, -1));
		await reserveDelivery(env.DB, {
			letterId: letter.id,
			recipientId: reader.id,
			reportToken: "report-1",
			now: T0,
		});
		const asked = await app.request("/report/report-1", {}, env);
		expect(asked.status).toBe(HTTP_OK);
		expect(asked.headers.get("content-language")).toBe("ja");
		expect(await asked.text()).toContain(
			`<h1>${inHtml(web("ja").report.ask.title)}</h1>`,
		);
		expect(await eventKinds()).not.toContain("letter_reported");
		const reported = await app.request("/report/report-1", post(), env);
		expect(reported.status).toBe(HTTP_OK);
		expect(reported.headers.get("content-language")).toBe("ja");
		expect(await reported.text()).toContain(
			inHtml(web("ja").report.thanks.title),
		);
		expect((await app.request("/report/report-1", post(), env)).status).toBe(
			HTTP_OK,
		);
		const unknown = await app.request("/report/unknown", {}, env);
		expect(unknown.status).toBe(HTTP_NOT_FOUND);
		expect(await unknown.text()).toContain(
			inHtml(web("en").report.unknown.title),
		);
		expect((await app.request("/report", {}, env)).status).toBe(HTTP_NOT_FOUND);
		expect(
			(await eventKinds()).filter((kind) => kind === "letter_reported"),
		).toHaveLength(1);
	});
});

describe("the operator's page", () => {
	it("is closed without the token Access signs, through header or cookie", async () => {
		const app = createApp(() => fakePorts());
		const closed = await app.request("/admin", {}, env);
		expect(closed.status).toBe(HTTP_UNAUTHORIZED);
		expect(await closed.text()).toContain(
			inHtml(web("en").operator.signIn.title),
		);
		expect(
			(
				await app.request(
					"/admin",
					{ headers: { "cf-access-jwt-assertion": "forged" } },
					env,
				)
			).status,
		).toBe(HTTP_UNAUTHORIZED);
		expect(
			(await app.request("/admin", { headers: AS_OPERATOR }, env)).status,
		).toBe(HTTP_OK);
		expect(
			(
				await app.request(
					"/admin",
					{ headers: { cookie: `CF_Authorization=${OPERATOR_TOKEN}` } },
					env,
				)
			).status,
		).toBe(HTTP_OK);
	});

	it("shows the numbers and that nothing waits", async () => {
		const ports = fakePorts();
		const app = createApp(() => ports);
		const writer = await seedActiveUser(ports, WRITER);
		await seedActiveUser(ports, READER, 1);
		await seedTravelingLetter(ports, writer, addMillis(T0, 1));
		const body = await (
			await app.request("/admin", { headers: AS_OPERATOR }, env)
		).text();
		expect(body).toContain(`<h1>${inHtml(web("en").operator.title)}</h1>`);
		expect(body).toContain(inHtml(web("en").operator.numbers("2", "1", "0")));
		expect(body).toContain(inHtml(web("en").operator.nothingReported));
		expect(body).not.toContain("<form");
	});

	it("shows the letters the model has not answered about nowhere, not even to the operator", async () => {
		const ports = fakePorts();
		const app = createApp(() => ports);
		const writer = await seedActiveUser(ports, WRITER);
		await seedHeldLetter(ports, writer, "A waiting <letter>");
		const listed = await (
			await app.request("/admin", { headers: AS_OPERATOR }, env)
		).text();
		expect(listed).not.toContain(inHtml("A waiting <letter>"));
		expect(listed).toContain(inHtml(web("en").operator.nothingReported));
	});

	it("says that the text of a letter reported after its erasure is no longer kept", async () => {
		const ports = fakePorts();
		const app = createApp(() => ports);
		const writer = await seedActiveUser(ports, WRITER);
		const reader = await seedActiveUser(ports, READER, 1);
		const letter = await seedTravelingLetter(
			ports,
			writer,
			addMillis(T0, -1),
			"a letter <nobody> kept",
		);
		await reserveDelivery(env.DB, {
			letterId: letter.id,
			recipientId: reader.id,
			reportToken: "report-1",
			now: T0,
		});
		await eraseLetters(env.DB, { settledBefore: T0, now: addMillis(T0, 1) });
		await reportDelivery(env.DB, "report-1", addMillis(T0, 2));
		const listed = await (
			await app.request("/admin", { headers: AS_OPERATOR }, env)
		).text();
		expect(listed).not.toContain(inHtml("a letter <nobody> kept"));
		expect(listed).toContain(inHtml(web("en").operator.erased));
		expect(listed).toContain(inHtml(web("en").operator.reports("1")));
		expect(listed).toContain(`formaction="/admin/writers/${writer.id}/ban"`);
	});

	it("lists a reported letter with its count, closes it, or bans the writer", async () => {
		const ports = fakePorts();
		const app = createApp(() => ports);
		const writer = await seedActiveUser(ports, WRITER);
		const reader = await seedActiveUser(ports, READER, 2);
		const letter = await seedTravelingLetter(ports, writer, addMillis(T0, -1));
		const other = await seedTravelingLetter(
			ports,
			writer,
			addMillis(T0, 1),
			"still on its way",
		);
		await reserveDelivery(env.DB, {
			letterId: letter.id,
			recipientId: reader.id,
			reportToken: "report-1",
			now: T0,
		});
		await reportDelivery(env.DB, "report-1", T0);
		await reportDelivery(env.DB, "report-1", T0);
		const listed = await (
			await app.request("/admin", { headers: AS_OPERATOR }, env)
		).text();
		expect(listed).toContain(inHtml(letter.body));
		expect(listed).toContain(inHtml(web("en").operator.reports("1")));
		expect(listed).toContain(`formaction="/admin/letters/${letter.id}/close"`);
		expect(listed).toContain(`formaction="/admin/writers/${writer.id}/ban"`);

		const closed = await app.request(
			`/admin/letters/${letter.id}/close`,
			post(undefined, AS_OPERATOR),
			env,
		);
		expect(closed.status).toBe(HTTP_SEE_OTHER);
		expect(
			await (await app.request("/admin", { headers: AS_OPERATOR }, env)).text(),
		).toContain(inHtml(web("en").operator.nothingReported));

		// One delivery carries one report, so the same link cannot reopen a closed one.
		await reportDelivery(env.DB, "report-1", addMillis(T0, 1));
		expect(
			await (await app.request("/admin", { headers: AS_OPERATOR }, env)).text(),
		).toContain(inHtml(web("en").operator.nothingReported));

		const banned = await app.request(
			`/admin/writers/${writer.id}/ban`,
			post(undefined, AS_OPERATOR),
			env,
		);
		expect(banned.status).toBe(HTTP_SEE_OTHER);
		expect(must(await findUserByEmail(env.DB, writer.email)).status).toBe(
			"banned",
		);
		expect(must(await findLetter(env.DB, other.id)).status).toBe("lost");
		expect(must(await findLetter(env.DB, letter.id)).status).toBe("delivered");
		expect(
			await (await app.request("/admin", { headers: AS_OPERATOR }, env)).text(),
		).toContain(inHtml(web("en").operator.nothingReported));
		expect(await eventKinds()).toContain("user_banned");
	});

	it("changes nothing for a post without the operator's token or for an unknown letter", async () => {
		const ports = fakePorts();
		const app = createApp(() => ports);
		const writer = await seedActiveUser(ports, WRITER);
		const letter = await seedTravelingLetter(ports, writer, addMillis(T0, 1));
		for (const path of [
			`/admin/letters/${letter.id}/close`,
			`/admin/writers/${writer.id}/ban`,
		]) {
			expect((await app.request(path, post(), env)).status).toBe(
				HTTP_UNAUTHORIZED,
			);
		}
		expect(must(await findLetter(env.DB, letter.id)).status).toBe("traveling");
		expect(must(await findUserByEmail(env.DB, writer.email)).status).toBe(
			"active",
		);
		for (const path of [
			"/admin/letters/nope/close",
			"/admin/writers/nope/ban",
		]) {
			expect(
				(await app.request(path, post(undefined, AS_OPERATOR), env)).status,
			).toBe(HTTP_NOT_FOUND);
		}
		expect(ports.sent).toHaveLength(0);
	});

	it("reads in the operator's browser language", async () => {
		const app = createApp(() => fakePorts());
		const response = await app.request(
			"/admin",
			{ headers: { ...AS_OPERATOR, "Accept-Language": "ja" } },
			env,
		);
		expect(response.headers.get("content-language")).toBe("ja");
		expect(await response.text()).toContain(
			inHtml(web("ja").operator.nothingReported),
		);
	});
});
