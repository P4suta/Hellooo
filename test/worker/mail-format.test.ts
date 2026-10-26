import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { DAY_MS } from "../../src/core/duration.ts";
import { SUPPORTED_LOCALES } from "../../src/core/locale.ts";
import { messagesFor } from "../../src/core/messages.ts";
import { addMillis } from "../../src/core/types.ts";
import { runDelivery } from "../../src/worker/delivery.ts";
import { publicPath } from "../../src/worker/env.ts";
import { handleIncomingEmail } from "../../src/worker/intake.ts";
import { must } from "../support/must.ts";
import { useEmptyStorage } from "./d1.ts";
import {
	CONFIG,
	fakeMessage,
	fakePorts,
	pageKeyFor,
	seedActiveUser,
	seedTravelingLetter,
	T0,
	verifyTokenOf,
} from "./fakes.ts";
import { rawMail } from "./raw-mail.ts";

useEmptyStorage();

const LETTERS = CONFIG.LETTERS_ADDRESS;
const MAX_SUBJECT_CHARS = 200;
const MAX_LINE_CHARS = 998;
/** A link into the Worker names a page and a key, and carries no query string. */
const LINK_PATH = /^\/(verify|confirm|you|stop|report)\/[^/?#]+$/;

type Outgoing = {
	readonly subject: string;
	readonly text: string;
	readonly headers?: Readonly<Record<string, string>> | undefined;
};

function expectWellFormed(mail: Outgoing): void {
	expect(mail.subject).not.toMatch(/[\r\n]/);
	expect(mail.subject.length).toBeLessThanOrEqual(MAX_SUBJECT_CHARS);
	expect(mail.subject.startsWith(`${CONFIG.SERVICE_NAME}: `)).toBe(true);
	expect(mail.text).not.toContain("\r");
	expect(mail.text.endsWith("\n")).toBe(true);
	expect(mail.text.trim().length).toBeGreaterThan(0);
	expect(mail.text).not.toContain("token=");
	expect(mail.text).not.toContain("lang=");
	for (const line of mail.text.split("\n")) {
		expect(line.length).toBeLessThanOrEqual(MAX_LINE_CHARS);
	}
	for (const link of mail.text.match(/https?:\/\/\S+/g) ?? []) {
		const url = new URL(link);
		expect(url.origin).toBe(new URL(CONFIG.PUBLIC_BASE_URL).origin);
		expect(url.pathname).toMatch(LINK_PATH);
		expect(url.search).toBe("");
		expect(url.hash).toBe("");
	}
}

describe.each(SUPPORTED_LOCALES)("outgoing mail in %s", (locale) => {
	it("replies are well formed and link back with the right key", async () => {
		const ports = fakePorts();
		const from = `writer-${locale}@example.com`;
		const message = fakeMessage(
			rawMail({ from, body: "Hellooo?", contentLanguage: locale }),
			from,
			LETTERS,
		);
		await handleIncomingEmail(message, env, ports);
		const reply = message.replies[0];
		expect(reply).toBeDefined();
		if (reply === undefined) {
			return;
		}
		expectWellFormed({ subject: reply.subject, text: reply.text ?? "" });
		expect(reply.text).toContain(
			`${CONFIG.PUBLIC_BASE_URL}${publicPath("verify", must(await verifyTokenOf(from)))}`,
		);
		expect(reply.subject).toBe(
			`${CONFIG.SERVICE_NAME}: ${messagesFor(locale).mail.verification.subject}`,
		);
		expect(reply.from).toEqual({ name: "Hellooo", email: LETTERS });
	});

	it("accepted letters are answered with the page about the writer's address", async () => {
		const ports = fakePorts();
		const from = `writer-${locale}@example.com`;
		await seedActiveUser(ports, from, 0, locale);
		const message = fakeMessage(
			rawMail({ from, body: "Hellooo?" }),
			from,
			LETTERS,
		);
		await handleIncomingEmail(message, env, ports);
		const reply = must(message.replies[0]);
		expectWellFormed({ subject: reply.subject, text: reply.text ?? "" });
		expect(reply.text).toContain(
			`${messagesFor(locale).mail.you} ${CONFIG.PUBLIC_BASE_URL}${publicPath("you", pageKeyFor(from))}`,
		);
	});

	it("deliveries are well formed and carry the one-click stop headers", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		const reader = await seedActiveUser(
			ports,
			`reader-${locale}@example.com`,
			1,
			locale,
		);
		await seedTravelingLetter(
			ports,
			writer,
			addMillis(T0, -DAY_MS),
			"x".repeat(MAX_LINE_CHARS),
		);
		await runDelivery(env, ports);
		const sent = ports.sent[0];
		expect(sent).toBeDefined();
		if (sent === undefined) {
			return;
		}
		expectWellFormed({ ...sent.mail, headers: sent.headers });
		expect(sent.to).toBe(reader.email);
		const key = pageKeyFor(reader.email);
		expect(sent.headers?.["List-Unsubscribe"]).toBe(
			`<${CONFIG.PUBLIC_BASE_URL}${publicPath("stop", key)}>`,
		);
		expect(sent.mail.text).toContain(
			`${messagesFor(locale).mail.you} ${CONFIG.PUBLIC_BASE_URL}${publicPath("you", key)}`,
		);
		expect(sent.mail.text).toContain(
			`${messagesFor(locale).mail.delivery.report} ${CONFIG.PUBLIC_BASE_URL}${publicPath("report", "")}`,
		);
		expect(sent.headers?.["List-Unsubscribe-Post"]).toBe(
			"List-Unsubscribe=One-Click",
		);
		expect(sent.headers?.["Auto-Submitted"]).toBe("auto-generated");
		expect(Object.keys(sent.headers ?? {}).sort()).toEqual([
			"Auto-Submitted",
			"List-Unsubscribe",
			"List-Unsubscribe-Post",
		]);
	});
});
