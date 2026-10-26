import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { addMillis } from "../../src/core/types.ts";
import { handleIncomingEmail } from "../../src/worker/intake.ts";
import {
	findUserByEmail,
	reportDelivery,
	reserveDelivery,
} from "../../src/worker/repository.ts";
import { createApp } from "../../src/worker/web.ts";
import { must } from "../support/must.ts";
import { useEmptyStorage } from "./d1.ts";
import {
	address,
	CONFIG,
	eventKinds,
	fakeMessage,
	fakePorts,
	letterBodies,
	letterStatuses,
	OPERATOR_TOKEN,
	seedActiveUser,
	seedTravelingLetter,
	T0,
	userCount,
} from "./fakes.ts";
import { rawMail } from "./raw-mail.ts";

useEmptyStorage();

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const LETTERS = CONFIG.LETTERS_ADDRESS;
const INJECTION = "'; DROP TABLE users; --";
const KEYED_PATHS = ["verify", "confirm", "you", "stop", "report"];

describe("hostile input", () => {
	it("stays data in every key", async () => {
		const app = createApp(() => fakePorts());
		for (const path of KEYED_PATHS) {
			for (const init of [{}, { method: "POST" }]) {
				const response = await app.request(
					`/${path}/${encodeURIComponent(INJECTION)}`,
					init,
					env,
				);
				expect([HTTP_OK, HTTP_NOT_FOUND]).toContain(response.status);
				expect(await response.text()).not.toContain("DROP TABLE");
			}
		}
		expect(await userCount()).toBe(0);
		expect(
			await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{
				n: number;
			}>(),
		).toEqual({ n: 0 });
	});

	it("never reflects a key, a query string, or a posted field into a page", async () => {
		const app = createApp(() => fakePorts());
		const script = "<script>alert(1)</script>";
		for (const path of [
			...KEYED_PATHS.map((path) => `/${path}/${encodeURIComponent(script)}`),
			`/?lang=${encodeURIComponent(script)}`,
			`/${encodeURIComponent(script)}`,
		]) {
			const response = await app.request(path, {}, env);
			const body = await response.text();
			expect(body).not.toContain(script);
			expect(body).not.toContain("alert(1)");
			expect(response.headers.get("content-language")).toBe("en");
		}
		const posted = await app.request(
			`/you/${encodeURIComponent(script)}`,
			{
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: `lang=${encodeURIComponent(script)}`,
			},
			env,
		);
		expect(await posted.text()).not.toContain("alert(1)");
	});

	it("escapes the operator's name and addresses on the front page", async () => {
		const app = createApp(() => fakePorts());
		const response = await app.request(
			"/",
			{},
			{
				...env,
				OPERATOR_NAME: '<img src=x onerror="alert(1)">',
			},
		);
		const body = await response.text();
		expect(body).not.toContain("<img");
		expect(body).toContain("&lt;img");
	});

	it("stores a hostile letter body verbatim and renders it only escaped, only to the operator", async () => {
		const ports = fakePorts();
		const writer = "writer@example.com";
		await seedActiveUser(ports, writer);
		const body = `${INJECTION}\n<script>alert('x')</script>\nBcc: injected header line`;
		await handleIncomingEmail(
			fakeMessage(rawMail({ from: writer, body }), writer, LETTERS),
			env,
			ports,
		);
		expect(await letterBodies()).toEqual([body]);
		expect(await letterStatuses()).toEqual(["traveling"]);
		const app = createApp(() => ports);
		for (const path of ["/", "/verify/x", "/report/x", "/you/x"]) {
			expect(await (await app.request(path, {}, env)).text()).not.toContain(
				"alert(",
			);
		}
		const reader = await seedActiveUser(ports, "reader@example.com", 1);
		const delivered = await seedTravelingLetter(
			ports,
			must(await findUserByEmail(env.DB, address(writer))),
			addMillis(T0, -1),
			body,
		);
		await reserveDelivery(env.DB, {
			letterId: delivered.id,
			recipientId: reader.id,
			reportToken: "report-1",
			now: T0,
		});
		await reportDelivery(env.DB, "report-1", T0);
		const operator = await (
			await app.request(
				"/admin",
				{ headers: { "cf-access-jwt-assertion": OPERATOR_TOKEN } },
				env,
			)
		).text();
		expect(operator).not.toContain("<script>");
		expect(operator).toContain("&lt;script&gt;");
	});

	it("stores a hostile address as data", async () => {
		const ports = fakePorts();
		const from = `"${INJECTION}"@example.com`;
		await handleIncomingEmail(
			fakeMessage(rawMail({ from, body: "hi" }), from, LETTERS),
			env,
			ports,
		);
		expect(await userCount()).toBe(0);
		expect(await eventKinds()).toEqual(["mail_ignored"]);
		expect(
			await env.DB.prepare("SELECT COUNT(*) AS n FROM letters").first<{
				n: number;
			}>(),
		).toEqual({ n: 0 });
	});

	it("ignores an Authentication-Results header the sender added below the server's own", async () => {
		const ports = fakePorts();
		const raw = rawMail({
			body: "Trust me.",
			dmarc: "none",
			extraHeaders: [
				"Authentication-Results: attacker.example; dmarc=pass header.from=example.com",
			],
		}).replace(
			"dmarc=none header.from=example.com",
			"spf=pass smtp.mailfrom=example.com",
		);
		const message = fakeMessage(raw, "writer@example.com", LETTERS);
		await handleIncomingEmail(message, env, ports);
		expect(message.replies).toHaveLength(0);
		expect(await userCount()).toBe(0);
		expect(await eventKinds()).toEqual(["mail_ignored"]);
	});

	it("keeps addresses and letter bodies out of the event log", async () => {
		const ports = fakePorts();
		const writer = "writer@example.com";
		await seedActiveUser(ports, writer);
		const body = "A very private letter about my life.";
		await handleIncomingEmail(
			fakeMessage(rawMail({ from: writer, body }), writer, LETTERS),
			env,
			ports,
		);
		const { results } = await env.DB.prepare(
			"SELECT kind, detail FROM events",
		).all<{
			kind: string;
			detail: string | null;
		}>();
		for (const row of results) {
			expect(row.detail ?? "").not.toContain("@");
			expect(row.detail ?? "").not.toContain("private letter");
		}
	});

	it("refuses every post from another site, even the operator's", async () => {
		const ports = fakePorts();
		const app = createApp(() => ports);
		const writer = await seedActiveUser(ports, "writer@example.com");
		const response = await app.request(
			`/admin/writers/${writer.id}/ban`,
			{
				method: "POST",
				headers: {
					"cf-access-jwt-assertion": OPERATOR_TOKEN,
					origin: "https://evil.example",
				},
			},
			env,
		);
		expect(response.status).toBe(HTTP_FORBIDDEN);
		expect(must(await findUserByEmail(env.DB, writer.email)).status).toBe(
			"active",
		);
	});
});
