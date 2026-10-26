import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_LOCALE,
	detectLocaleFromText,
	formatDate,
	localeFromContentLanguage,
	localeFromLanguageTag,
	negotiateLocale,
	SUPPORTED_LOCALES,
} from "../../src/core/locale.ts";
import { instant } from "../../src/core/types.ts";
import { must } from "../support/must.ts";

const JANUARY_14_2027_MS = Date.UTC(2027, 0, 14);

describe("localeFromLanguageTag", () => {
	it.each([
		["en", "en"],
		["EN", "en"],
		["en-US", "en"],
		["ja", "ja"],
		["ja-JP", "ja"],
		[" ja ", "ja"],
	])("maps %j to %j", (tag, locale) => {
		expect(localeFromLanguageTag(tag)).toBe(locale);
	});

	it.each(["", "fr", "zh-Hans", "*", "japanese", "e"])("rejects %j", (tag) => {
		expect(localeFromLanguageTag(tag)).toBeNull();
	});
});

describe("negotiateLocale", () => {
	it("falls back to the default without a header", () => {
		expect(negotiateLocale(null)).toBe(DEFAULT_LOCALE);
		expect(negotiateLocale(undefined)).toBe(DEFAULT_LOCALE);
		expect(negotiateLocale("")).toBe(DEFAULT_LOCALE);
	});

	it.each([
		["ja", "ja"],
		["ja-JP,ja;q=0.9,en;q=0.8", "ja"],
		["en-US,en;q=0.9,ja;q=0.8", "en"],
		["fr-FR,fr;q=0.9,ja;q=0.8", "ja"],
		["fr, de", "en"],
		["ja;q=0.3, en;q=0.9", "en"],
		["en;q=0, ja;q=0.1", "ja"],
		["*", "en"],
		["zh;q=0.9, *;q=0.1, ja;q=0.2", "ja"],
		["JA-jp ; q=1.0", "ja"],
		["ja;q=abc, en", "en"],
		["ja;q=, en", "en"],
		["ja;q=0.8,en;q=0.9", "en"],
		["ja;q=0.9,en;q=0.8", "ja"],
		["en;q=0.8,ja;q=0.9", "ja"],
		["ja, en", "ja"],
		["en, ja", "en"],
		["ja;q=0", "en"],
		["ja;q=-1", "en"],
		["*;q=1, ja;q=0.5", "en"],
		["ja;q=0.5, *", "en"],
		["ja, *", "ja"],
		["ja;", "ja"],
		["ja ; q = 0.9", "ja"],
		["ja; q=0.5, en", "en"],
		["ja;foo=bar;q=0.2, en;q=0.1", "ja"],
		["ja;quality=0.1, en;q=0.9", "ja"],
		[",,ja,,", "ja"],
	])("negotiates %j to %j", (header, locale) => {
		expect(negotiateLocale(header)).toBe(locale);
	});

	it("prefers the heavier weight whatever the order, and the earlier entry on ties", () => {
		fc.assert(
			fc.property(
				fc.double({ min: 0.001, max: 1, noNaN: true }),
				fc.double({ min: 0.001, max: 1, noNaN: true }),
				(jaWeight, enWeight) => {
					const header = `ja;q=${jaWeight}, en;q=${enWeight}`;
					const expected = enWeight > jaWeight ? "en" : "ja";
					return negotiateLocale(header) === expected;
				},
			),
		);
	});

	it("always answers a supported locale", () => {
		fc.assert(
			fc.property(fc.string(), (header) =>
				SUPPORTED_LOCALES.includes(negotiateLocale(header)),
			),
		);
	});
});

describe("detectLocaleFromText", () => {
	it("reads kana as Japanese and leaves everything else undecided", () => {
		expect(detectLocaleFromText("こんにちは、元気ですか。")).toBe("ja");
		expect(detectLocaleFromText("Hello ハロー")).toBe("ja");
		expect(detectLocaleFromText("Hellooo? Anybody there?")).toBeNull();
		expect(detectLocaleFromText("")).toBeNull();
		expect(detectLocaleFromText("今日雨")).toBeNull();
	});
});

describe("localeFromContentLanguage", () => {
	it("reads the first language of the header", () => {
		expect(localeFromContentLanguage("ja-JP, en")).toBe("ja");
		expect(localeFromContentLanguage("en")).toBe("en");
		expect(localeFromContentLanguage("en, ja")).toBe("en");
		expect(localeFromContentLanguage("fr, ja")).toBeNull();
		expect(localeFromContentLanguage("fr")).toBeNull();
		expect(localeFromContentLanguage(undefined)).toBeNull();
		expect(localeFromContentLanguage(null)).toBeNull();
		expect(localeFromContentLanguage("")).toBeNull();
	});
});

describe("formatDate", () => {
	it("writes the date in the reader's language", () => {
		const at = must(instant(JANUARY_14_2027_MS));
		expect(formatDate("en", at)).toBe("January 14, 2027");
		expect(formatDate("ja", at)).toBe("2027年1月14日");
	});
});
