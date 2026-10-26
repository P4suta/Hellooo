import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "../../src/core/locale.ts";
import { createApp } from "../../src/worker/web.ts";
import { useEmptyStorage } from "./d1.ts";
import { fakePorts } from "./fakes.ts";

useEmptyStorage();

const PATHS = [
	"/",
	"/verify/nope",
	"/confirm/nope",
	"/you/nope",
	"/stop/nope",
	"/report/nope",
	"/terms",
	"/privacy",
	"/admin",
	"/nowhere",
];

describe.each(SUPPORTED_LOCALES)("every page in %s", (locale) => {
	it.each(PATHS)("is a complete, labeled HTML document at %s", async (path) => {
		const app = createApp(() => fakePorts());
		const response = await app.request(
			path,
			{ headers: { "Accept-Language": locale } },
			env,
		);
		expect(response.headers.get("content-type")).toMatch(/^text\/html/);
		expect(response.headers.get("content-language")).toBe(locale);
		expect(response.headers.get("vary")).toBe("Accept-Language");
		expect(response.headers.get("cache-control")).toBe("no-store");
		// Not `no-referrer`: under it a browser posts a form with `Origin: null`, which the origin check refuses.
		expect(response.headers.get("referrer-policy")).toBe("same-origin");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(response.headers.get("x-frame-options")).toBe("DENY");
		const policy = response.headers.get("content-security-policy") ?? "";
		expect(policy).toContain("default-src 'none'");
		expect(policy).toContain("form-action 'self'");
		expect(policy).toContain("frame-ancestors 'none'");
		const body = await response.text();
		expect(body.startsWith("<!doctype html>")).toBe(true);
		expect(body).toContain(`<html lang="${locale}">`);
		expect(body).toContain('<meta charset="utf-8">');
		expect(body).toContain('<meta name="viewport"');
		expect(body).toContain('<link rel="icon"');
		expect(body.match(/<h1>/g)).toHaveLength(1);
		expect(body).toMatch(
			path === "/"
				? /<title>Hellooo<\/title>/
				: /<title>[^<]+ · Hellooo<\/title>/,
		);
		expect(body).not.toMatch(/<[^>]*\$\{/);
		expect(body).not.toContain("undefined");
		expect(body).not.toContain("[object Object]");
		expect(body).not.toContain("<script");
	});
});

describe("pages across locales", () => {
	it.each(PATHS)("differ between English and Japanese at %s", async (path) => {
		const app = createApp(() => fakePorts());
		const english = await (
			await app.request(path, { headers: { "Accept-Language": "en" } }, env)
		).text();
		const japanese = await (
			await app.request(path, { headers: { "Accept-Language": "ja" } }, env)
		).text();
		expect(english).not.toBe(japanese);
		expect(japanese).toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}]/u);
		expect(english).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}]/u);
	});
});

describe("motion", () => {
	it("is declared in the stylesheet alone and stops under reduced motion", async () => {
		const app = createApp(() => fakePorts());
		const body = await (await app.request("/", {}, env)).text();
		expect(body).toContain("@keyframes appear");
		expect(body).toContain("@keyframes beckon");
		expect(body).toContain("prefers-reduced-motion:reduce");
		expect(body).toContain("animation:none!important");
		expect(body).toContain("@supports (animation-timeline:view())");
		expect(body).toContain("prefers-color-scheme:dark");
	});
});
