import {
	createExecutionContext,
	createScheduledController,
	waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../../src/worker/index.ts";
import withDmarcPass from "../fixtures/letter-with-dmarc-pass.eml?raw";
import { useEmptyStorage } from "./d1.ts";
import { CONFIG, eventKinds, fakeMessage } from "./fakes.ts";

useEmptyStorage();

const HTTP_OK = 200;

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
