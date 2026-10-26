import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "../../src/core/locale.ts";
import { MESSAGES, messagesFor } from "../../src/core/messages.ts";

const SERVICE = "Hellooo";
const LINK = "https://service.example/verify/abc";
const DATE = "January 14, 2027";
const ADDRESS = "letters@service.example";
const PRINTABLE_ASCII = /^[\x20-\x7E]*$/;

type Leaf = string | ((...args: string[]) => string | readonly string[]);

function leaves(value: unknown, path: string): [string, Leaf][] {
	if (typeof value === "string" || typeof value === "function") {
		return [[path, value as Leaf]];
	}
	if (value !== null && typeof value === "object") {
		return Object.entries(value).flatMap(([key, child]) =>
			leaves(child, `${path}.${key}`),
		);
	}
	throw new Error(`unexpected catalog value at ${path}`);
}

function rendered(leaf: Leaf): string[] {
	if (typeof leaf === "string") {
		return [leaf];
	}
	const out = leaf(SERVICE, LINK, DATE, ADDRESS);
	return typeof out === "string" ? [out] : [...out];
}

describe("message catalogs", () => {
	it("exist for every supported locale with the same keys", () => {
		const [first, ...rest] = SUPPORTED_LOCALES.map((locale) =>
			leaves(MESSAGES[locale], locale)
				.map(([path]) => path.slice(locale.length))
				.sort(),
		);
		expect(first?.length).toBeGreaterThan(0);
		for (const keys of rest) {
			expect(keys).toEqual(first);
		}
	});

	it.each(SUPPORTED_LOCALES)("has no empty text in %s", (locale) => {
		for (const [path, leaf] of leaves(MESSAGES[locale], locale)) {
			for (const text of rendered(leaf)) {
				expect(text.trim(), path).not.toBe("");
				expect(text, path).toBe(text.trim());
			}
		}
	});

	it.each(SUPPORTED_LOCALES)(
		"keeps subjects and titles on one line in %s",
		(locale) => {
			for (const [path, leaf] of leaves(MESSAGES[locale], locale)) {
				if (path.endsWith(".subject") || path.endsWith(".title")) {
					for (const text of rendered(leaf)) {
						expect(text, path).not.toMatch(/[\r\n]/);
					}
				}
			}
		},
	);

	it.each(SUPPORTED_LOCALES)(
		"weaves every argument into the text in %s",
		(locale) => {
			const m = MESSAGES[locale];
			expect(m.mail.overCap.writeAgain(DATE)).toContain(DATE);
			expect(m.mail.delivery.footer(SERVICE)).toContain(SERVICE);
			expect(m.web.front.operated("Someone")).toContain("Someone");
			expect(m.web.verify.confirmed.next(ADDRESS)).toContain(ADDRESS);
			expect(m.web.front.write(ADDRESS).split(ADDRESS)).toHaveLength(2);
			expect(m.web.operator.reports("7")).toContain("7");
			const numbers = m.web.operator.numbers("12", "3", "40");
			for (const count of ["12", "3", "40"]) {
				expect(numbers).toContain(count);
			}
		},
	);

	it("writes Japanese in the Japanese catalog and plain ASCII in the English one", () => {
		const kana = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
		const japanese = leaves(MESSAGES.ja, "ja").flatMap(([, leaf]) =>
			rendered(leaf),
		);
		const english = leaves(MESSAGES.en, "en").flatMap(([, leaf]) =>
			rendered(leaf),
		);
		expect(japanese.filter((text) => kana.test(text)).length).toBeGreaterThan(
			japanese.length / 2,
		);
		for (const text of english) {
			expect(text).toMatch(PRINTABLE_ASCII);
		}
	});

	it("uses full-width punctuation and no half-width katakana in Japanese", () => {
		for (const text of leaves(MESSAGES.ja, "ja").flatMap(([, leaf]) =>
			rendered(leaf),
		)) {
			expect(text).not.toMatch(/[｡-ﾟ]/);
			expect(text).not.toMatch(/[^\s\x20-\x7E]\.(\s|$)/);
		}
	});

	it("gives distinct subjects to the outcomes a writer must tell apart", () => {
		for (const locale of SUPPORTED_LOCALES) {
			const mail = MESSAGES[locale].mail;
			const subjects = [
				mail.verification.subject,
				mail.confirmation.subject,
				mail.accepted.subject,
				mail.overCap.subject,
				mail.cannotTravel.subject,
				mail.exhausted.subject,
				mail.delivery.subject,
			];
			expect(new Set(subjects).size).toBe(subjects.length);
		}
	});

	it("resolves a catalog by locale", () => {
		expect(messagesFor("ja")).toBe(MESSAGES.ja);
		expect(messagesFor("en")).toBe(MESSAGES.en);
	});
});
