import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { addMillis } from "../../src/core/types.ts";
import { runDelivery } from "../../src/worker/delivery.ts";
import {
	createPendingUser,
	unsubscribe,
	verifyUser,
} from "../../src/worker/repository.ts";
import { useEmptyStorage } from "./d1.ts";
import {
	address,
	creditsOf,
	fakePorts,
	letterStatuses,
	seedActiveUser,
	seedTravelingLetter,
	T0,
} from "./fakes.ts";

useEmptyStorage();

describe("overlapping runs", () => {
	it("deliver a letter once even when two delivery runs overlap", async () => {
		const ports = fakePorts();
		const writer = await seedActiveUser(ports, "writer@example.com");
		const readerA = await seedActiveUser(ports, "a@example.com", 1);
		const readerB = await seedActiveUser(ports, "b@example.com", 1);
		await seedTravelingLetter(ports, writer, addMillis(T0, -1));
		const [first, second] = await Promise.all([
			runDelivery(env, ports),
			runDelivery(env, ports),
		]);
		expect(first.delivered + second.delivered).toBe(1);
		expect(ports.sent).toHaveLength(1);
		expect(await letterStatuses()).toEqual(["delivered"]);
		expect((await creditsOf(readerA)) + (await creditsOf(readerB))).toBe(1);
		const deliveries = await env.DB.prepare(
			"SELECT COUNT(*) AS n FROM deliveries",
		).first<{
			n: number;
		}>();
		expect(deliveries).toEqual({ n: 1 });
	});

	it("verify an address once even when the link is opened twice at the same time", async () => {
		await createPendingUser(env.DB, {
			id: "user-1",
			email: address("writer@example.com"),
			verifyToken: "verify-1",
			pageKey: "page-1",
			locale: "en",
			now: T0,
		});
		const results = await Promise.all([
			verifyUser(env.DB, "verify-1", T0),
			verifyUser(env.DB, "verify-1", T0),
		]);
		expect(results.filter((r) => r !== null)).toHaveLength(1);
	});

	it("unsubscribe once even when the link is clicked twice at the same time", async () => {
		const ports = fakePorts();
		await seedActiveUser(ports, "reader@example.com", 1);
		const results = await Promise.all([
			unsubscribe(env.DB, "page-reader@example.com", T0),
			unsubscribe(env.DB, "page-reader@example.com", T0),
		]);
		expect(results.filter(Boolean)).toHaveLength(1);
	});
});
