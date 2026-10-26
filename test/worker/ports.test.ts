import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { readConfig } from "../../src/worker/env.ts";
import {
	now,
	productionPorts,
	sendFailure,
	token,
	uniform,
} from "../../src/worker/ports.ts";
import { address } from "./fakes.ts";

/** An Email Sending binding that answers every send the same way. */
function emailThat(
	answer: (message: EmailMessageBuilder) => Promise<{ messageId: string }>,
): Env {
	return {
		...env,
		EMAIL: {
			send: async (message: EmailMessage | EmailMessageBuilder) => {
				if (!("subject" in message)) {
					throw new Error("the ports send a builder");
				}
				return answer(message);
			},
		},
	};
}

/** An error as the binding throws it: a standard Error with a string code. */
function bindingError(code: string): Error {
	return Object.assign(new Error("the binding refused the message"), { code });
}

const SAMPLES = 1000;
const TOKEN_HEX_LENGTH = 64;

describe("the production clock and randomness", () => {
	it("read a safe integer instant that is not in the past of this test", () => {
		const before = Date.now();
		const at = now();
		expect(Number.isSafeInteger(at)).toBe(true);
		expect(at).toBeGreaterThanOrEqual(before);
	});

	it("draw uniforms inside [0, 1)", () => {
		for (let i = 0; i < SAMPLES; i += 1) {
			const u = uniform();
			expect(u).toBeGreaterThanOrEqual(0);
			expect(u).toBeLessThan(1);
		}
	});

	it("draw hex tokens that do not repeat", () => {
		const tokens = new Set<string>();
		for (let i = 0; i < SAMPLES; i += 1) {
			const t = token();
			expect(t).toMatch(/^[0-9a-f]+$/);
			expect(t).toHaveLength(TOKEN_HEX_LENGTH);
			tokens.add(t);
		}
		expect(tokens.size).toBe(SAMPLES);
	});
});

describe("productionPorts", () => {
	it("send mail through the Email Sending binding with the service as sender", async () => {
		const captured: EmailMessageBuilder[] = [];
		const fakeEnv = emailThat(async (message) => {
			captured.push(message);
			return { messageId: "provider-1" };
		});
		const config = readConfig(fakeEnv);
		const ports = productionPorts(fakeEnv, config);
		const outcome = await ports.send({
			to: address("reader@example.com"),
			mail: { subject: "a subject", text: "body\n" },
			headers: { "List-Unsubscribe": "<https://example.com/stop>" },
		});
		expect(outcome).toEqual({ kind: "sent", messageId: "provider-1" });
		expect(captured).toEqual([
			{
				from: { name: config.SERVICE_NAME, email: config.NOTICES_ADDRESS },
				to: "reader@example.com",
				subject: "a subject",
				text: "body\n",
				headers: { "List-Unsubscribe": "<https://example.com/stop>" },
			},
		]);
	});

	it("send mail without a headers field when none is given", async () => {
		const captured: EmailMessageBuilder[] = [];
		const fakeEnv = emailThat(async (message) => {
			captured.push(message);
			return { messageId: "provider-2" };
		});
		const ports = productionPorts(fakeEnv, readConfig(fakeEnv));
		await ports.send({
			to: address("reader@example.com"),
			mail: { subject: "s", text: "t\n" },
		});
		expect(captured[0]).not.toHaveProperty("headers");
	});

	it("report a suppressed recipient as a decision about the address", async () => {
		const fakeEnv = emailThat(async () => {
			throw bindingError("E_RECIPIENT_SUPPRESSED");
		});
		const ports = productionPorts(fakeEnv, readConfig(fakeEnv));
		expect(
			await ports.send({
				to: address("gone@example.com"),
				mail: { subject: "s", text: "t\n" },
			}),
		).toEqual({ kind: "suppressed" });
	});

	it("report any other refusal by its code, never by a message", async () => {
		const fakeEnv = emailThat(async () => {
			throw bindingError("E_ACCOUNT_SUSPENDED");
		});
		const ports = productionPorts(fakeEnv, readConfig(fakeEnv));
		expect(
			await ports.send({
				to: address("reader@example.com"),
				mail: { subject: "s", text: "t\n" },
			}),
		).toEqual({ kind: "failed", reason: "E_ACCOUNT_SUSPENDED" });
	});

	it("name a failure without a code by the error's name or the thrown value's type", () => {
		expect(
			sendFailure(new TypeError("fetch failed to reader@example.com")),
		).toEqual({ kind: "failed", reason: "TypeError" });
		expect(sendFailure("reader@example.com is gone")).toEqual({
			kind: "failed",
			reason: "string",
		});
		expect(sendFailure({ code: 42 })).toEqual({
			kind: "failed",
			reason: "object",
		});
	});

	it("generate ids that look like UUIDs", () => {
		const ports = productionPorts(env, readConfig(env));
		expect(ports.newId()).toMatch(/^[0-9a-f-]{36}$/);
		expect(ports.newId()).not.toBe(ports.newId());
	});
});
