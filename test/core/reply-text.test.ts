import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "../../src/core/locale.ts";
import { messagesFor } from "../../src/core/messages.ts";
import {
	acceptedMail,
	confirmationMail,
	deliveryMail,
	type Mail,
	overCapMail,
	rejectedContentMail,
	rejectedTextMail,
	rejectionsExhaustedMail,
	verificationMail,
} from "../../src/core/reply-text.ts";
import { instant } from "../../src/core/types.ts";
import { must } from "../support/must.ts";

const SERVICE = "Hellooo";
const LINK = "https://service.example/verify/abc";
const YOU = "https://service.example/you/k";
const JANUARY_14_2027_MS = Date.UTC(2027, 0, 14);
const BODY = "Hellooo? Anybody there?";
const LINKS = {
	you: YOU,
	report: "https://service.example/report/r",
};

function expectMail(mail: Mail): void {
	expect(mail.subject.startsWith(`${SERVICE}:`)).toBe(true);
	expect(mail.subject).not.toContain("\n");
	expect(mail.text.trim().length).toBeGreaterThan(0);
	expect(mail.text.endsWith("\n")).toBe(true);
	expect(mail.text).not.toContain("\r");
}

describe.each(SUPPORTED_LOCALES)("reply texts in %s", (locale) => {
	it("carry the link the reader must follow", () => {
		for (const mail of [
			verificationMail(locale, SERVICE, LINK),
			confirmationMail(locale, SERVICE, LINK),
		]) {
			expectMail(mail);
			expect(mail.text).toContain(LINK);
		}
	});

	it("end an accepted letter with the page about the writer's address", () => {
		const mail = acceptedMail(locale, SERVICE, YOU);
		expectMail(mail);
		expect(mail.text.endsWith(`${messagesFor(locale).mail.you} ${YOU}\n`)).toBe(
			true,
		);
	});

	it("name the day a capped sender may write again in the reader's language", () => {
		const mail = overCapMail(
			locale,
			SERVICE,
			must(instant(JANUARY_14_2027_MS)),
		);
		expectMail(mail);
		expect(mail.text).toContain(
			locale === "ja" ? "2027年1月14日" : "January 14, 2027",
		);
	});

	it("explain every text problem", () => {
		const subjects = new Set<string>();
		for (const problem of [
			"empty",
			"url",
			"email-address",
			"phone-number",
		] as const) {
			const mail = rejectedTextMail(locale, SERVICE, problem);
			expectMail(mail);
			subjects.add(mail.subject);
		}
		expect(subjects.size).toBe(1);
	});

	it("exist for the remaining outcomes with distinct subjects", () => {
		const mails = [
			acceptedMail(locale, SERVICE, YOU),
			rejectedContentMail(locale, SERVICE),
			rejectionsExhaustedMail(locale, SERVICE),
		];
		for (const mail of mails) {
			expectMail(mail);
		}
		expect(new Set(mails.map((mail) => mail.subject)).size).toBe(mails.length);
	});

	it("deliver the body verbatim with the page about the reader and the report link", () => {
		const mail = deliveryMail(locale, SERVICE, BODY, LINKS);
		expectMail(mail);
		expect(mail.text.startsWith(`${BODY}\n\n— — —\n\n`)).toBe(true);
		expect(mail.text).toContain(`${messagesFor(locale).mail.you} ${LINKS.you}`);
		expect(mail.text).toContain(
			`${messagesFor(locale).mail.delivery.report} ${LINKS.report}`,
		);
	});
});

describe("reply texts across locales", () => {
	it("differ between English and Japanese", () => {
		expect(acceptedMail("ja", SERVICE, YOU).text).not.toBe(
			acceptedMail("en", SERVICE, YOU).text,
		);
		expect(verificationMail("ja", SERVICE, LINK).subject).not.toBe(
			verificationMail("en", SERVICE, LINK).subject,
		);
	});
});
