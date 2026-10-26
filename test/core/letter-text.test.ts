import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
	LETTER_MAX_CHARS,
	prepareLetterText,
} from "../../src/core/letter-text.ts";

const PROBLEMS = ["empty", "url", "email-address", "phone-number"];

describe("prepareLetterText", () => {
	it("rejects a blank body", () => {
		expect(prepareLetterText("  \r\n\n\t ")).toEqual({
			ok: false,
			problem: "empty",
		});
		expect(prepareLetterText("")).toEqual({ ok: false, problem: "empty" });
	});

	it.each([
		["see https://example.com/x for more", "url"],
		["see HTTPS://EXAMPLE.COM for more", "url"],
		["ftp://files.example.com/a.txt", "url"],
		["visit www.example.com", "url"],
		["visit WWW.EXAMPLE.COM today", "url"],
		["write me at someone@example.org please", "email-address"],
		["mailto:someone@example.org", "email-address"],
		["call 090-1234-5678 tonight", "phone-number"],
		["or +81 3 1234 5678", "phone-number"],
		["or +1 (415) 555-0132", "phone-number"],
		["digits 123456789 in a row", "phone-number"],
		["電話は０９０−１２３４−５６７８へ", "phone-number"],
		["or 090-１２３４-5678 mixed", "phone-number"],
		["ｗｗｗ．example．com をどうぞ", "url"],
		["ｈｔｔｐｓ：／／example.com", "url"],
		["ｓｏｍｅｏｎｅ＠example．org", "email-address"],
	])("rejects %j as %s", (raw, problem) => {
		expect(prepareLetterText(raw)).toEqual({ ok: false, problem });
	});

	it.each([
		"I am 42 and it is 2026, not 2024 2025.",
		"We met on 2026-10-26 at 12:30.",
		"Room 1204, floor 12, seat 7.",
		"Pi is about 3.14159 and e about 2.71828.",
		"example.com without a scheme is a word to me",
		"an at sign @ alone, or a@b, is not an address",
		"Awww. That is sweet of you.",
		"www is short for world wide web",
		"12345678 has eight digits, 2019-2020 were hard years",
		"the ratio is 3 : 4, written 3://4 by nobody",
	])("keeps %j", (raw) => {
		expect(prepareLetterText(raw)).toEqual({ ok: true, text: raw });
	});

	it("rejects a scheme of any length before ://", () => {
		expect(prepareLetterText("see x://host/path")).toEqual({
			ok: false,
			problem: "url",
		});
		expect(prepareLetterText("see svn+ssh://host/path")).toEqual({
			ok: false,
			problem: "url",
		});
	});

	it("rejects nine digits with or without separators", () => {
		expect(prepareLetterText("123456789")).toEqual({
			ok: false,
			problem: "phone-number",
		});
		expect(prepareLetterText("(12) 34-56-789")).toEqual({
			ok: false,
			problem: "phone-number",
		});
	});

	it("names the first problem when several exist", () => {
		expect(
			prepareLetterText("https://example.com and someone@example.org"),
		).toEqual({ ok: false, problem: "url" });
		expect(prepareLetterText("someone@example.org and 090-1234-5678")).toEqual({
			ok: false,
			problem: "email-address",
		});
	});

	it("normalizes line endings and trims each line", () => {
		expect(prepareLetterText("hello \r\nworld\t\r\n\r\n\r\n\r\nbye")).toEqual({
			ok: true,
			text: "hello\nworld\n\nbye",
		});
		expect(prepareLetterText("\n\nlonely\n\n")).toEqual({
			ok: true,
			text: "lonely",
		});
		expect(prepareLetterText("old\rmac\rbreaks")).toEqual({
			ok: true,
			text: "old\nmac\nbreaks",
		});
		expect(prepareLetterText("two  \nspaces \t \nend")).toEqual({
			ok: true,
			text: "two\nspaces\nend",
		});
		expect(prepareLetterText("three\n\n\nblank")).toEqual({
			ok: true,
			text: "three\n\nblank",
		});
		expect(prepareLetterText("two\n\nblank")).toEqual({
			ok: true,
			text: "two\n\nblank",
		});
	});

	it("trims before counting the limit and after cutting at it", () => {
		const padded = `${" ".repeat(LETTER_MAX_CHARS)}hello`;
		expect(prepareLetterText(padded)).toEqual({ ok: true, text: "hello" });
		const head = "a".repeat(LETTER_MAX_CHARS - 1);
		const cutAtSpace = `${head} ${"b".repeat(10)}`;
		expect(prepareLetterText(cutAtSpace)).toEqual({ ok: true, text: head });
	});

	it("keeps Japanese, emoji, and other scripts intact", () => {
		const text = "今日は雨です。☔ Привет, 안녕, مرحبا";
		expect(prepareLetterText(text)).toEqual({ ok: true, text });
	});

	it("truncates to the letter limit by code point, not by UTF-16 unit", () => {
		const long = "😀".repeat(LETTER_MAX_CHARS + 10);
		const result = prepareLetterText(long);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect([...result.text]).toHaveLength(LETTER_MAX_CHARS);
			expect(result.text.length).toBe(LETTER_MAX_CHARS * "😀".length);
		}
	});

	it("keeps exactly the limit untouched", () => {
		const exact = "字".repeat(LETTER_MAX_CHARS);
		expect(prepareLetterText(exact)).toEqual({ ok: true, text: exact });
	});

	it("returns bounded text without carriage returns, or a named problem", () => {
		fc.assert(
			fc.property(fc.string({ unit: "grapheme" }), (raw) => {
				const result = prepareLetterText(raw);
				if (!result.ok) {
					return PROBLEMS.includes(result.problem);
				}
				return (
					result.text.length > 0 &&
					!result.text.includes("\r") &&
					!result.text.startsWith("\n") &&
					!result.text.endsWith("\n") &&
					[...result.text].length <= LETTER_MAX_CHARS
				);
			}),
		);
	});

	it("is idempotent on accepted text", () => {
		fc.assert(
			fc.property(fc.string({ unit: "grapheme" }), (raw) => {
				const once = prepareLetterText(raw);
				if (!once.ok) {
					return true;
				}
				const twice = prepareLetterText(once.text);
				return twice.ok && twice.text === once.text;
			}),
		);
	});
});
