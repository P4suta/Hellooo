import { Hono, type Context as HonoContext } from "hono";
import { getCookie } from "hono/cookie";
import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import {
	type Locale,
	localeFromLanguageTag,
	negotiateLocale,
	SUPPORTED_LOCALES,
} from "../core/locale.ts";
import { type Messages, messagesFor } from "../core/messages.ts";
import { letterId, userId } from "../core/types.ts";
import { youControls, youView } from "../core/you-page.ts";
import { admitLetter } from "./admission.ts";
import { type Config, publicPath, readConfig } from "./env.ts";
import { type Ports, productionPorts } from "./ports.ts";
import {
	banWriter,
	closeReports,
	confirmLetter,
	findDelivery,
	findLetter,
	findLetterByConfirmToken,
	findPendingVerification,
	findUserById,
	findUserByPageKey,
	type Letter,
	operatorNumbers,
	reportDelivery,
	reportedLetters,
	setLocale,
	type User,
	unsubscribe,
	verifyUser,
} from "./repository.ts";

const HTTP_OK = 200;
const HTTP_SEE_OTHER = 303;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;

/** The operator's pages, guarded by Cloudflare Access. */
const OPERATOR_PATH = "/admin";
/** The header and the cookie through which Cloudflare Access hands a Worker the token it signed. */
const ACCESS_HEADER = "cf-access-jwt-assertion";
const ACCESS_COOKIE = "CF_Authorization";

/** The two colors of the design, light and dark, which the stylesheet, the theme color, and the favicon share. */
const COLORS = {
	light: { bg: "#fff", fg: "#141414" },
	dark: { bg: "#121212", fg: "#ededed" },
} as const;

/**
 * Every page carries a key or is tiny, so nothing is cached, no referrer leaves with a key in it, and a page may load only its own inline style and its inline icon.
 * Forms post to the same origin only, and nothing may frame a page.
 */
const RESPONSE_HEADERS: Readonly<Record<string, string>> = {
	"Cache-Control": "no-store",
	"Referrer-Policy": "no-referrer",
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "DENY",
	"Content-Security-Policy":
		"default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

/** A down chevron that moves the front page to its next screen. */
const CHEVRON =
	'<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';

/** The question mark of the first screen as the tab's icon, in the text color of either scheme. */
const FAVICON = `data:image/svg+xml,${encodeURIComponent(
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><style>text{font:500 46px Inter,system-ui,sans-serif;fill:${COLORS.light.fg}}@media(prefers-color-scheme:dark){text{fill:${COLORS.dark.fg}}}</style><text x="32" y="50" text-anchor="middle">?</text></svg>`,
)}`;

/**
 * The design's tokens and its motion: two colors with a dark mode, one type family per language, the 24 pixel rhythm,
 * a greeting that appears line by line, screens whose lines rise into view as they arrive, and a chevron that beckons.
 * Every movement stops under `prefers-reduced-motion`, and nothing depends on a script.
 */
const STYLE = [
	`:root{--color-bg:${COLORS.light.bg};--color-fg:${COLORS.light.fg};--font:Inter,"Noto Sans JP",system-ui,sans-serif;--ease:cubic-bezier(.2,.7,.2,1)}`,
	`@media (prefers-color-scheme:dark){:root{--color-bg:${COLORS.dark.bg};--color-fg:${COLORS.dark.fg}}}`,
	'html[lang=ja]{--font:"Noto Sans JP",Inter,system-ui,sans-serif}',
	"html{scroll-snap-type:y mandatory;scroll-behavior:smooth;-webkit-text-size-adjust:100%}",
	"body{margin:0;background:var(--color-bg);color:var(--color-fg);font:17px/28px var(--font)}",
	"main{max-width:560px;margin:0 auto;padding:0 24px;box-sizing:border-box}",
	"section{min-height:100vh;min-height:100svh;scroll-snap-align:start;display:flex;flex-direction:column;justify-content:center;position:relative;padding-bottom:96px;box-sizing:border-box}",
	".page{padding:96px 24px}",
	"h1,.lead{font-size:28px;line-height:36px;font-weight:400;letter-spacing:-.01em;margin:0 0 24px;text-wrap:balance;overflow-wrap:anywhere}",
	"h2{font-size:inherit;font-weight:400;margin:48px 0 24px;opacity:.56}",
	"p{margin:0 0 24px;text-wrap:pretty}",
	".letter{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 24px}",
	"a,button{color:inherit;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:.18em;transition:text-underline-offset .4s var(--ease)}",
	"button{font:inherit;background:none;border:0;padding:0;cursor:pointer}",
	"a:hover,button:hover{text-underline-offset:.32em}",
	"a:focus-visible,button:focus-visible{outline:1px solid currentColor;outline-offset:4px}",
	".next{position:absolute;bottom:48px;left:0;right:0;text-align:center;line-height:0}",
	".next svg{opacity:.56;transition:opacity .4s var(--ease);animation:beckon 1.6s ease-in-out infinite alternate}",
	".next:hover svg{opacity:1}",
	"footer{margin-top:24px;font-size:14px;line-height:22px;opacity:.56}",
	"footer p{margin:0 0 4px}",
	".quiet{opacity:.56}",
	"@keyframes appear{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}",
	"@keyframes beckon{to{transform:translateY(6px)}}",
	"#hello>*{animation:appear 1.4s var(--ease) both}",
	"#hello .lead{animation-delay:1s}",
	"#hello .next{animation-delay:2.1s}",
	".page>*{animation:appear .9s var(--ease) both}",
	".page>:nth-child(2){animation-delay:.2s}",
	".page>:nth-child(3){animation-delay:.4s}",
	".page>:nth-child(n+4){animation-delay:.6s}",
	"@supports (animation-timeline:view()){section:not(#hello)>:not(.next){animation:appear linear both;animation-timeline:view();animation-range:entry 20% entry 70%}section:not(#hello)>:nth-child(2){animation-range:entry 30% entry 80%}section:not(#hello)>:nth-child(3){animation-range:entry 40% entry 90%}}",
	"@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{animation:none!important;transition:none!important}}",
].join("");

type Variables = {
	readonly config: Config;
	readonly ports: Ports;
	readonly locale: Locale;
	readonly messages: Messages;
};
type Page = HtmlEscapedString | Promise<HtmlEscapedString>;
type App = Hono<{ Bindings: Env; Variables: Variables }>;
type Context = HonoContext<{ Bindings: Env; Variables: Variables }>;

export function createApp(
	portsFor: (env: Env, config: Config) => Ports = productionPorts,
) {
	const app: App = new Hono();

	app.use(async (c, next) => {
		const config = readConfig(c.env);
		const locale =
			localeFromLanguageTag(c.req.query("lang") ?? "") ??
			negotiateLocale(c.req.header("accept-language"));
		c.set("config", config);
		c.set("ports", portsFor(c.env, config));
		c.set("locale", locale);
		c.set("messages", messagesFor(locale));
		c.header("Content-Language", locale);
		c.header("Vary", "Accept-Language");
		for (const [name, value] of Object.entries(RESPONSE_HEADERS)) {
			c.header(name, value);
		}
		if (c.req.method === "POST" && !fromThisOrigin(c)) {
			return c.text("", HTTP_FORBIDDEN);
		}
		await next();
	});

	app.get("/", (c) => {
		const config = c.get("config");
		const locale = c.get("locale");
		const m = c.get("messages").web.front;
		const next = (target: string): Page =>
			html`<a class="next" href="${target}" aria-label="${m.next}">${raw(CHEVRON)}</a>`;
		// The sentence names the address once, and the page renders that one mention as the link.
		const [before = "", after = ""] = m
			.write(config.LETTERS_ADDRESS)
			.split(config.LETTERS_ADDRESS);
		return respond(
			c,
			locale,
			document(
				locale,
				config,
				config.SERVICE_NAME,
				html`<main>
<section id="hello"><h1>${m.hello}</h1><p class="lead">${m.anybody}</p>${next("#write")}</section>
<section id="write"><p>${before}<a href="mailto:${config.LETTERS_ADDRESS}">${config.LETTERS_ADDRESS}</a>${after}</p>${next("#only")}</section>
<section id="only"><p>${m.rules}</p><p>${m.only}</p><footer><p>${m.operated(config.OPERATOR_NAME)}</p><p>${m.contact} <a href="mailto:${config.NOTICES_ADDRESS}">${config.NOTICES_ADDRESS}</a></p></footer></section>
</main>`,
			),
		);
	});

	app.get("/verify/:key", async (c) => {
		const user = await findPendingVerification(c.env.DB, c.req.param("key"));
		if (user === null) {
			return answer(c, c.get("locale"), (m) => m.verify.used, HTTP_NOT_FOUND);
		}
		return ask(c, user.locale, (m) => m.verify.ask, html``);
	});

	app.post("/verify/:key", async (c) => {
		const config = c.get("config");
		const ports = c.get("ports");
		const now = ports.now();
		const verified = await verifyUser(c.env.DB, c.req.param("key"), now);
		if (verified === null) {
			return answer(c, c.get("locale"), (m) => m.verify.used, HTTP_NOT_FOUND);
		}
		let traveling = 0;
		for (const letter of verified.waiting) {
			const outcome = await admitLetter(c.env.DB, ports, letter, now);
			if (outcome.kind === "accept" || outcome.kind === "retry-later") {
				traveling += 1;
			}
		}
		const locale = verified.user.locale;
		const m = messagesFor(locale).web.verify.confirmed;
		return respond(
			c,
			locale,
			page(
				locale,
				config,
				m.title,
				html`<p>${traveling > 0 ? m.traveling : m.next(config.LETTERS_ADDRESS)}</p>`,
			),
		);
	});

	app.get("/confirm/:key", async (c) => {
		const letter = await findLetterByConfirmToken(c.env.DB, c.req.param("key"));
		if (letter === null) {
			return answer(c, c.get("locale"), (m) => m.confirm.used, HTTP_NOT_FOUND);
		}
		const locale =
			(await findUserById(c.env.DB, letter.senderId))?.locale ??
			c.get("locale");
		return ask(
			c,
			locale,
			(m) => m.confirm.ask,
			html`<pre class="letter">${letter.body}</pre>`,
		);
	});

	app.post("/confirm/:key", async (c) => {
		const config = c.get("config");
		const ports = c.get("ports");
		const now = ports.now();
		const letter = await confirmLetter(c.env.DB, c.req.param("key"), now);
		if (letter === null) {
			return answer(c, c.get("locale"), (m) => m.confirm.used, HTTP_NOT_FOUND);
		}
		const outcome = await admitLetter(c.env.DB, ports, letter, now);
		const locale =
			(await findUserById(c.env.DB, letter.senderId))?.locale ??
			c.get("locale");
		const m = messagesFor(locale);
		const line =
			outcome.kind === "reject-content"
				? m.web.confirm.confirmed.refused
				: outcome.kind === "over-cap"
					? m.mail.overCap.dropped
					: m.web.confirm.confirmed.traveling;
		return respond(
			c,
			locale,
			page(locale, config, m.web.confirm.confirmed.title, html`<p>${line}</p>`),
		);
	});

	app.get("/you/:key", (c) => you(c, c.req.param("key"), false));
	app.get("/stop/:key", (c) => you(c, c.req.param("key"), false));

	app.post("/you/:key", async (c) => {
		const key = c.req.param("key");
		const user = await findUserByPageKey(c.env.DB, key);
		if (user === null) {
			return unknown(c);
		}
		const chosen = localeFromLanguageTag(
			new URLSearchParams(await c.req.text()).get("lang") ?? "",
		);
		if (chosen !== null && youControls(user.status)) {
			await setLocale(c.env.DB, user.id, chosen, c.get("ports").now());
		}
		return you(c, key, false);
	});

	app.post("/stop/:key", async (c) => {
		const key = c.req.param("key");
		const stopped = await unsubscribe(c.env.DB, key, c.get("ports").now());
		return you(c, key, stopped);
	});

	app.get("/report/:key", async (c) => {
		const delivery = await findDelivery(c.env.DB, c.req.param("key"));
		if (delivery === null) {
			return answer(
				c,
				c.get("locale"),
				(m) => m.report.unknown,
				HTTP_NOT_FOUND,
			);
		}
		const locale =
			(await findUserById(c.env.DB, delivery.recipientId))?.locale ??
			c.get("locale");
		return ask(c, locale, (m) => m.report.ask, html``);
	});

	app.post("/report/:key", async (c) => {
		const report = await reportDelivery(
			c.env.DB,
			c.req.param("key"),
			c.get("ports").now(),
		);
		if (report === null) {
			return answer(
				c,
				c.get("locale"),
				(m) => m.report.unknown,
				HTTP_NOT_FOUND,
			);
		}
		const locale =
			(await findUserById(c.env.DB, report.recipientId))?.locale ??
			c.get("locale");
		return answer(c, locale, (m) => m.report.thanks);
	});

	app.route(OPERATOR_PATH, operatorPages());

	app.notFound((c) => unknown(c));

	return app;
}

/** The pages behind Cloudflare Access: the numbers, the reported letters, and the two decisions the operator can take. */
function operatorPages(): App {
	const admin: App = new Hono();

	admin.use(async (c, next) => {
		const token =
			c.req.header(ACCESS_HEADER) ?? getCookie(c, ACCESS_COOKIE) ?? undefined;
		if ((await c.get("ports").operator(token)) === null) {
			return answer(
				c,
				c.get("locale"),
				(m) => m.operator.signIn,
				HTTP_UNAUTHORIZED,
			);
		}
		await next();
	});

	admin.get("/", async (c) => {
		const config = c.get("config");
		const locale = c.get("locale");
		const m = c.get("messages").web.operator;
		const numbers = await operatorNumbers(c.env.DB);
		const reported = await reportedLetters(c.env.DB);
		const decision = (letter: Letter) =>
			html`<form method="post"><p><button formaction="${OPERATOR_PATH}/letters/${letter.id}/close">${m.close}</button> · <button formaction="${OPERATOR_PATH}/writers/${letter.senderId}/ban">${m.ban}</button></p></form>`;
		return respond(
			c,
			locale,
			page(
				locale,
				config,
				m.title,
				html`<p>${m.numbers(String(numbers.receiving), String(numbers.onTheirWay), String(numbers.delivered))}</p>
<h2>${m.reported}</h2>
${reported.length === 0 ? html`<p>${m.nothingReported}</p>` : reported.map(({ letter, reports }) => html`<article>${letter.erasedAt === null ? html`<pre class="letter">${letter.body}</pre>` : html`<p class="quiet">${m.erased}</p>`}<p class="quiet">${m.reports(String(reports))}</p>${decision(letter)}</article>`)}`,
			),
		);
	});

	admin.post("/letters/:id/close", async (c) => {
		const id = letterId(c.req.param("id"));
		if (id === null || (await findLetter(c.env.DB, id)) === null) {
			return unknown(c);
		}
		await closeReports(c.env.DB, id, c.get("ports").now());
		return c.redirect(OPERATOR_PATH, HTTP_SEE_OTHER);
	});

	admin.post("/writers/:id/ban", async (c) => {
		const id = userId(c.req.param("id"));
		if (id === null || (await findUserById(c.env.DB, id)) === null) {
			return unknown(c);
		}
		await banWriter(c.env.DB, id, c.get("ports").now());
		return c.redirect(OPERATOR_PATH, HTTP_SEE_OTHER);
	});

	return admin;
}

/**
 * The page about one address: whether letters reach it, the language of its mail, and the way to stop.
 * It reads in the language stored for the address, and `farewell` adds the thanks after a stop.
 */
async function you(c: Context, key: string, farewell: boolean) {
	const config = c.get("config");
	const user: User | null = await findUserByPageKey(c.env.DB, key);
	if (user === null) {
		return unknown(c);
	}
	const locale = user.locale;
	const m = messagesFor(locale).web.you;
	const view = youView(user.status);
	const state =
		view === "waiting"
			? m.waiting
			: view === "receiving"
				? m.receiving
				: m.stopped;
	const others = SUPPORTED_LOCALES.filter((other) => other !== locale);
	const controls = youControls(user.status)
		? html`<form method="post" action="${publicPath("you", key)}"><p>${others.map((other, index) => html`${index > 0 ? " · " : ""}<button name="lang" value="${other}">${m.switchTo[other]}</button>`)}</p></form>
<form method="post" action="${publicPath("stop", key)}"><p><button>${m.stop}</button></p></form>`
		: "";
	return respond(
		c,
		locale,
		page(
			locale,
			config,
			user.email,
			html`<p>${state}</p>
${farewell ? html`<p>${m.farewell}</p>` : ""}
${controls}`,
		),
	);
}

/**
 * A page that asks before it acts: a title, an optional line, what the action concerns, and one button that posts to the same path.
 * A link in a mail only ever shows this page, because mail scanners open links.
 */
function ask(
	c: Context,
	locale: Locale,
	pick: (web: Messages["web"]) => {
		readonly title: string;
		readonly body?: string;
		readonly button: string;
	},
	subject: Page,
) {
	const text = pick(messagesFor(locale).web);
	return respond(
		c,
		locale,
		page(
			locale,
			c.get("config"),
			text.title,
			html`${text.body === undefined ? "" : html`<p>${text.body}</p>`}
${subject}
<form method="post"><p><button>${text.button}</button></p></form>`,
		),
	);
}

/** A page with one title and one line, chosen from the catalog of the given language. */
function answer(
	c: Context,
	locale: Locale,
	pick: (web: Messages["web"]) => {
		readonly title: string;
		readonly body: string;
	},
	status:
		| typeof HTTP_OK
		| typeof HTTP_UNAUTHORIZED
		| typeof HTTP_NOT_FOUND = HTTP_OK,
) {
	const text = pick(messagesFor(locale).web);
	return respond(
		c,
		locale,
		page(locale, c.get("config"), text.title, html`<p>${text.body}</p>`),
		status,
	);
}

/** The page for a key or a path that leads nowhere, in the visitor's language. */
function unknown(c: Context) {
	return answer(c, c.get("locale"), (m) => m.unknown, HTTP_NOT_FOUND);
}

function respond(
	c: Context,
	locale: Locale,
	body: Page,
	status:
		| typeof HTTP_OK
		| typeof HTTP_UNAUTHORIZED
		| typeof HTTP_NOT_FOUND = HTTP_OK,
) {
	c.header("Content-Language", locale);
	return c.html(body, status);
}

/**
 * A browser names the page's origin in `Origin` and `Sec-Fetch-Site` on every form post, so a post from another site is refused.
 * A mail client's one-click stop sends neither header, so an absent header is accepted.
 */
function fromThisOrigin(c: Context): boolean {
	const origin = c.req.header("origin");
	const site = c.req.header("sec-fetch-site");
	return (
		(origin === undefined || origin === new URL(c.req.url).origin) &&
		(site === undefined || site === "same-origin" || site === "none")
	);
}

/** A page with one title and a few lines, in the same column as the front page. */
function page(locale: Locale, config: Config, title: string, body: Page): Page {
	return document(
		locale,
		config,
		title,
		html`<main class="page">
<h1>${title}</h1>
${body}
</main>`,
	);
}

/** The HTML shell: the design's tokens as custom properties, the type of the reader's language, and light or dark by preference. */
function document(
	locale: Locale,
	config: Config,
	title: string,
	body: Page,
): Page {
	return html`<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="description" content="${messagesFor(locale).web.front.write(config.LETTERS_ADDRESS)}">
<meta name="theme-color" content="${COLORS.light.bg}" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="${COLORS.dark.bg}" media="(prefers-color-scheme: dark)">
<title>${title === config.SERVICE_NAME ? title : `${title} · ${config.SERVICE_NAME}`}</title>
<link rel="icon" href="${FAVICON}">
<style>${raw(STYLE)}</style>
</head>
<body>
${body}
</body>
</html>`;
}
