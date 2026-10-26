import { describe, expect, it } from "vitest";
import { dmarcResult } from "../../src/core/authentication-results.ts";
import { normalizeEmailAddress } from "../../src/core/email-address.ts";
import { plainTextOfHtml } from "../../src/core/html-text.ts";
import {
	LETTER_MAX_CHARS,
	prepareLetterText,
} from "../../src/core/letter-text.ts";
import { negotiateLocale } from "../../src/core/locale.ts";

const LONG = 50_000;
const BUDGET_MS = 2_000;

function timed<T>(run: () => T): T {
	const started = performance.now();
	const result = run();
	expect(performance.now() - started).toBeLessThan(BUDGET_MS);
	return result;
}

describe("the parsers under adversarial lengths", () => {
	it("prepare a letter made of separators and digits without stalling", () => {
		const result = timed(() => prepareLetterText("1 ".repeat(LONG)));
		expect(result).toEqual({ ok: false, problem: "phone-number" });
	});

	it("prepare a letter made of one enormous word without stalling", () => {
		const result = timed(() => prepareLetterText("a".repeat(LONG)));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.text.length).toBe(LETTER_MAX_CHARS);
		}
	});

	it("prepare a letter of scheme-like tokens without stalling", () => {
		const result = timed(() =>
			prepareLetterText("abc+def-ghi.jkl:".repeat(LONG / 16)),
		);
		expect(result.ok).toBe(true);
	});

	it("read an authentication header of enormous length", () => {
		expect(
			timed(() =>
				dmarcResult([`mx.cloudflare.net; ${"(".repeat(LONG)} dmarc=pass`]),
			),
		).toBe("none");
		expect(
			timed(() => dmarcResult([`${"a=b; ".repeat(LONG / 5)}dmarc=pass`])),
		).toBe("pass");
	});

	it("strip markup from an enormous unbalanced document", () => {
		const text = timed(() =>
			plainTextOfHtml(`${"<".repeat(LONG)}x${"&".repeat(LONG)}`),
		);
		expect(text).not.toContain(">");
		expect(text.length).toBeGreaterThan(0);
	});

	it("reject an enormous address quickly", () => {
		expect(
			timed(() => normalizeEmailAddress(`${"a".repeat(LONG)}@example.com`)),
		).toBeNull();
		expect(
			timed(() => normalizeEmailAddress(`a@${"b.".repeat(LONG)}com`)),
		).toBeNull();
	});

	it("negotiate an enormous Accept-Language header", () => {
		expect(
			timed(() => negotiateLocale(`${"fr;q=0.9, ".repeat(LONG / 10)}ja`)),
		).toBe("ja");
	});
});
