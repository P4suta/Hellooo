import { describe, expect, it } from "vitest";
import { DAY_MS } from "../../src/core/duration.ts";
import { BODY_RETENTION_MS } from "../../src/core/erasure.ts";
import {
	type LegalFacts,
	PROCESSORS,
	privacyPage,
	RETENTION_DAYS,
	termsPage,
} from "../../src/core/legal.ts";
import {
	isAssignedRegion,
	regionName,
	SUPPORTED_LOCALES,
} from "../../src/core/locale.ts";

const FACTS: LegalFacts = {
	service: "Hellooo",
	operator: "Someone Operating",
	contact: "post@service.example",
	jurisdiction: "Somewhere",
};
const PRINTABLE_ASCII = /^[\x20-\x7E]*$/;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;

describe("the terms and the privacy notice", () => {
	it.each(SUPPORTED_LOCALES)(
		"have a title, headed sections, and no empty line in %s",
		(locale) => {
			for (const page of [
				termsPage(locale, FACTS),
				privacyPage(locale, FACTS),
			]) {
				expect(page.title.trim()).not.toBe("");
				expect(page.sections.length).toBeGreaterThan(3);
				for (const section of page.sections) {
					expect(section.heading.trim()).not.toBe("");
					expect(section.lines.length).toBeGreaterThan(0);
					for (const line of section.lines) {
						expect(line).toBe(line.trim());
						expect(line).not.toBe("");
					}
				}
			}
		},
	);

	it.each(SUPPORTED_LOCALES)(
		"weave the service, the contact, and the jurisdiction into the terms in %s",
		(locale) => {
			const text = termsPage(locale, FACTS)
				.sections.flatMap((section) => section.lines)
				.join("\n");
			expect(text).toContain(FACTS.service);
			expect(text).toContain(FACTS.contact);
			expect(text).toContain(FACTS.jurisdiction);
		},
	);

	it.each(SUPPORTED_LOCALES)(
		"state the retention, the processors, and the operator in the privacy notice in %s",
		(locale) => {
			const text = privacyPage(locale, FACTS)
				.sections.flatMap((section) => section.lines)
				.join("\n");
			expect(text).toContain(String(RETENTION_DAYS));
			expect(text).toContain(PROCESSORS.hosting);
			expect(text).toContain(PROCESSORS.moderation);
			expect(text).toContain(FACTS.operator);
			expect(text).toContain(FACTS.contact);
		},
	);

	it("count the retention in whole days that add up to the erasure period", () => {
		expect(Number.isInteger(RETENTION_DAYS)).toBe(true);
		expect(RETENTION_DAYS).toBeGreaterThan(0);
		expect(RETENTION_DAYS * DAY_MS).toBe(BODY_RETENTION_MS);
	});

	it("write Japanese in the Japanese pages and plain ASCII in the English ones", () => {
		const lines = (locale: "en" | "ja") =>
			[termsPage(locale, FACTS), privacyPage(locale, FACTS)].flatMap((page) => [
				page.title,
				...page.sections.flatMap((section) => [
					section.heading,
					...section.lines,
				]),
			]);
		for (const line of lines("en")) {
			expect(line).toMatch(PRINTABLE_ASCII);
		}
		expect(
			lines("ja").filter((line) => KANA.test(line)).length,
		).toBeGreaterThan(lines("ja").length / 2);
	});
});

describe("regionName", () => {
	it("spells a region code out in each language", () => {
		expect(regionName("en", "JP")).toBe("Japan");
		expect(regionName("ja", "JP")).toBe("日本");
		expect(regionName("en", "DE")).toBe("Germany");
	});
});

describe("isAssignedRegion", () => {
	it("knows the assigned codes and refuses the user-assigned and unknown ones", () => {
		expect(isAssignedRegion("JP")).toBe(true);
		expect(isAssignedRegion("DE")).toBe(true);
		expect(isAssignedRegion("QQ")).toBe(false);
		expect(isAssignedRegion("XA")).toBe(false);
		expect(isAssignedRegion("ZZ")).toBe(false);
	});
});
