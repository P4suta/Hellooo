import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { must } from "../support/must.ts";
import { migrationsOf, useEmptyStorage } from "./d1.ts";
import { T0 } from "./fakes.ts";

useEmptyStorage();

async function columns(table: string): Promise<string[]> {
	const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{
		name: string;
	}>();
	return results.map((row) => row.name).sort();
}

async function names(type: "table" | "index"): Promise<string[]> {
	const { results } = await env.DB.prepare(
		"SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%' AND name NOT LIKE '_cf_%' ORDER BY name",
	)
		.bind(type)
		.all<{ name: string }>();
	return results.map((row) => row.name);
}

describe("the schema", () => {
	it("has the four tables with their columns", async () => {
		expect(await names("table")).toEqual([
			"deliveries",
			"events",
			"letters",
			"users",
		]);
		expect(await columns("users")).toEqual(
			[
				"id",
				"email",
				"status",
				"credits",
				"verify_token",
				"page_key",
				"created_at",
				"verified_at",
				"locale",
			].sort(),
		);
		expect(await columns("letters")).toEqual(
			[
				"id",
				"sender_id",
				"body",
				"status",
				"confirm_token",
				"moderation",
				"created_at",
				"accepted_at",
				"deliver_after",
				"erased_at",
			].sort(),
		);
		expect(await columns("deliveries")).toEqual(
			[
				"letter_id",
				"recipient_id",
				"report_token",
				"provider_message_id",
				"sent_at",
			].sort(),
		);
		expect(await columns("events")).toEqual(
			["id", "kind", "user_id", "letter_id", "detail", "created_at"].sort(),
		);
	});

	it("indexes the lookups the handlers run", async () => {
		const indexes = await names("index");
		expect(indexes).toEqual(
			expect.arrayContaining([
				"letters_due",
				"letters_sender_accepted",
				"deliveries_recipient",
				"events_user_kind",
			]),
		);
	});

	it.each([
		[
			"a user status outside the vocabulary",
			"INSERT INTO users (id, email, status, page_key, created_at) VALUES ('u', 'u@example.com', 'ghost', 't', 0)",
		],
		[
			"negative credits",
			"INSERT INTO users (id, email, status, credits, page_key, created_at) VALUES ('u', 'u@example.com', 'active', -1, 't', 0)",
		],
		[
			"a letter status outside the vocabulary",
			"INSERT INTO letters (id, sender_id, body, status, created_at) VALUES ('l', 'u', 'b', 'flying', 0)",
		],
		[
			"a letter without a body",
			"INSERT INTO letters (id, sender_id, status, created_at) VALUES ('l', 'u', 'held', 0)",
		],
	])("refuses %s", async (_name, sql) => {
		await expect(env.DB.prepare(sql).run()).rejects.toThrow();
	});

	it("keeps addresses and tokens unique", async () => {
		await env.DB.prepare(
			"INSERT INTO users (id, email, status, page_key, verify_token, created_at) VALUES ('a', 'a@example.com', 'pending', 'ua', 'va', 0)",
		).run();
		for (const sql of [
			"INSERT INTO users (id, email, status, page_key, created_at) VALUES ('b', 'a@example.com', 'pending', 'ub', 0)",
			"INSERT INTO users (id, email, status, page_key, created_at) VALUES ('b', 'b@example.com', 'pending', 'ua', 0)",
			"INSERT INTO users (id, email, status, page_key, verify_token, created_at) VALUES ('b', 'b@example.com', 'pending', 'ub', 'va', 0)",
			"INSERT INTO users (id, email, status, page_key, created_at) VALUES ('a', 'c@example.com', 'pending', 'uc', 0)",
		]) {
			await expect(env.DB.prepare(sql).run()).rejects.toThrow();
		}
	});

	it("allows one delivery per letter and one report token per delivery", async () => {
		await env.DB.batch([
			env.DB.prepare(
				"INSERT INTO users (id, email, status, page_key, created_at) VALUES ('s', 's@example.com', 'active', 'us', 0), ('r1', 'r1@example.com', 'active', 'ur1', 0), ('r2', 'r2@example.com', 'active', 'ur2', 0)",
			),
			env.DB.prepare(
				"INSERT INTO letters (id, sender_id, body, status, created_at) VALUES ('l', 's', 'a', 'traveling', 0), ('m', 's', 'b', 'traveling', 0)",
			),
			env.DB.prepare(
				"INSERT INTO deliveries (letter_id, recipient_id, report_token, sent_at) VALUES ('l', 'r1', 't1', 0)",
			),
		]);
		await expect(
			env.DB.prepare(
				"INSERT INTO deliveries (letter_id, recipient_id, report_token, sent_at) VALUES ('l', 'r2', 't2', 0)",
			).run(),
		).rejects.toThrow();
		await expect(
			env.DB.prepare(
				"INSERT INTO deliveries (letter_id, recipient_id, report_token, sent_at) VALUES ('m', 'r2', 't1', 0)",
			).run(),
		).rejects.toThrow();
	});

	it("refuses a delivery for an unknown letter or recipient", async () => {
		await expect(
			env.DB.prepare(
				"INSERT INTO deliveries (letter_id, recipient_id, report_token, sent_at) VALUES ('ghost', 'nobody', 't', 0)",
			).run(),
		).rejects.toThrow();
		await expect(
			env.DB.prepare(
				"INSERT INTO letters (id, sender_id, body, status, created_at) VALUES ('l', 'nobody', 'a', 'held', 0)",
			).run(),
		).rejects.toThrow();
	});
});

describe("the migrations", () => {
	it("give existing users the default language when the locale column arrives", async () => {
		await reset();
		const [first, ...rest] = migrationsOf(env);
		await applyD1Migrations(env.DB, [must(first)]);
		await env.DB.prepare(
			"INSERT INTO users (id, email, status, unsubscribe_token, created_at) VALUES ('old', 'old@example.com', 'active', 'u-old', ?)",
		)
			.bind(T0)
			.run();
		await applyD1Migrations(env.DB, rest);
		const row = await env.DB.prepare(
			"SELECT locale FROM users WHERE id = 'old'",
		).first<{
			locale: string;
		}>();
		expect(row).toEqual({ locale: "en" });
	});

	it("apply again without changing anything", async () => {
		const before = await names("table");
		await applyD1Migrations(env.DB, migrationsOf(env));
		expect(await names("table")).toEqual(before);
	});

	it("are numbered in order without gaps", () => {
		const numbers = migrationsOf(env).map((m) => Number(m.name.split("_")[0]));
		expect(numbers).toEqual(numbers.map((_, i) => i + 1));
	});
});
