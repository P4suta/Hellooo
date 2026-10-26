import {
	createExecutionContext,
	createScheduledController,
	waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "../../src/core/locale.ts";
import { messagesFor } from "../../src/core/messages.ts";
import worker, { runStages } from "../../src/worker/index.ts";
import withDmarcPass from "../fixtures/letter-with-dmarc-pass.eml?raw";
import { useEmptyStorage } from "./d1.ts";
import { CONFIG, eventKinds, fakeMessage } from "./fakes.ts";

useEmptyStorage();

const HTTP_OK = 200;
const HTTP_SERVICE_UNAVAILABLE = 503;

describe("the Worker's handlers", () => {
	it("serve the front page", async () => {
		const ctx = createExecutionContext();
		const response = await worker.fetch(
			new Request(`${CONFIG.PUBLIC_BASE_URL}/`),
			env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(HTTP_OK);
		expect(await response.text()).toContain(CONFIG.LETTERS_ADDRESS);
	});

	it("run the delivery job on the schedule without any due letter", async () => {
		const ctx = createExecutionContext();
		worker.scheduled(
			createScheduledController({ cron: "*/15 * * * *" }),
			env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(await eventKinds()).toEqual([]);
	});

	it("run every scheduled stage even when an earlier one fails, then fail the run", async () => {
		const ran: string[] = [];
		await expect(
			runStages([
				[
					"first",
					async () => {
						throw new Error("E_TEST_STAGE");
					},
				],
				[
					"second",
					async () => {
						ran.push("second");
					},
				],
				[
					"third",
					async () => {
						ran.push("third");
					},
				],
			]),
		).rejects.toThrow("stages failed: first");
		expect(ran).toEqual(["second", "third"]);
		await expect(
			runStages([["only", async () => undefined]]),
		).resolves.toBeUndefined();
	});

	it("answer with a notice, ignore mail, and skip the schedule while closed", async () => {
		const closed: Env = { ...env, SERVICE_CLOSED: "true" };
		const ctx = createExecutionContext();
		const response = await worker.fetch(
			new Request(`${CONFIG.PUBLIC_BASE_URL}/`),
			closed,
			ctx,
		);
		expect(response.status).toBe(HTTP_SERVICE_UNAVAILABLE);
		const text = await response.text();
		for (const locale of SUPPORTED_LOCALES) {
			expect(text).toContain(messagesFor(locale).web.front.closed);
		}
		const message = fakeMessage(
			withDmarcPass,
			"writer@example.com",
			CONFIG.LETTERS_ADDRESS,
		);
		await worker.email(message, closed, ctx);
		worker.scheduled(
			createScheduledController({ cron: "*/15 * * * *" }),
			closed,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(message.replies).toHaveLength(0);
		expect(await eventKinds()).toEqual([]);
	});

	it("route incoming mail through the intake", async () => {
		const ctx = createExecutionContext();
		const message = fakeMessage(
			withDmarcPass,
			"writer@example.com",
			CONFIG.NOTICES_ADDRESS,
		);
		await worker.email(message, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(await eventKinds()).toEqual(["mail_ignored"]);
	});
});
