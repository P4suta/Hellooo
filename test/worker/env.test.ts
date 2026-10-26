import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
	operatorAccess,
	publicLink,
	publicPath,
	readConfig,
} from "../../src/worker/env.ts";

describe("readConfig", () => {
	it("reads the bindings of the test Worker", () => {
		const config = readConfig(env);
		expect(config.SERVICE_NAME).toBe(env.SERVICE_NAME);
		expect(config.LETTERS_ADDRESS).toBe(env.LETTERS_ADDRESS);
		expect(config.NOTICES_ADDRESS).toBe(env.NOTICES_ADDRESS);
		expect(config.PUBLIC_BASE_URL).toBe(env.PUBLIC_BASE_URL);
		expect(config.MODERATION_MODEL).toBe(env.MODERATION_MODEL);
		expect(config.TYPESAFE_API_KEY).toBe("test-only");
	});

	it("lowercases the addresses", () => {
		const config = readConfig({
			...env,
			LETTERS_ADDRESS: ` ${env.LETTERS_ADDRESS.toUpperCase()} `,
		});
		expect(config.LETTERS_ADDRESS).toBe(env.LETTERS_ADDRESS.toLowerCase());
	});

	it.each<[string, Partial<Record<keyof Env, string>>]>([
		["a missing service name", { SERVICE_NAME: "" }],
		["a letters address without a domain", { LETTERS_ADDRESS: "hellooo" }],
		[
			"a notices address with spaces",
			{ NOTICES_ADDRESS: "post @service.example" },
		],
		["a base URL without a scheme", { PUBLIC_BASE_URL: "service.example" }],
		["an empty model", { MODERATION_MODEL: "" }],
		["an empty key", { TYPESAFE_API_KEY: "" }],
		["an Access issuer that is not a URL", { ACCESS_ISSUER: "team" }],
	])("refuses %s", (_name, override) => {
		expect(() => readConfig({ ...env, ...override })).toThrow();
	});
});

describe("public links", () => {
	it("name the page and the key in the path, and nothing else", () => {
		const config = readConfig(env);
		expect(publicPath("verify", "abc")).toBe("/verify/abc");
		expect(publicLink(config, "verify", "abc")).toBe(
			`${config.PUBLIC_BASE_URL}/verify/abc`,
		);
		expect(publicLink(config, "stop", "u")).toBe(
			`${config.PUBLIC_BASE_URL}/stop/u`,
		);
		expect(new URL(publicLink(config, "you", "k")).search).toBe("");
	});

	it("escape a key that is not URL safe", () => {
		const config = readConfig(env);
		expect(publicLink(config, "report", "a b&c=d/e?f")).toBe(
			`${config.PUBLIC_BASE_URL}/report/a%20b%26c%3Dd%2Fe%3Ff`,
		);
	});

	it("keep the public origin without its base path", () => {
		const config = readConfig({
			...env,
			PUBLIC_BASE_URL: "https://example.com/letters/",
		});
		expect(publicLink(config, "confirm", "t")).toBe(
			"https://example.com/confirm/t",
		);
	});
});

describe("operatorAccess", () => {
	it("stays closed while either setting is empty", () => {
		expect(
			operatorAccess(readConfig({ ...env, ACCESS_ISSUER: "", ACCESS_AUD: "" })),
		).toBeNull();
		expect(
			operatorAccess(
				readConfig({
					...env,
					ACCESS_ISSUER: "https://team.example",
					ACCESS_AUD: "",
				}),
			),
		).toBeNull();
		expect(
			operatorAccess(
				readConfig({ ...env, ACCESS_ISSUER: "", ACCESS_AUD: "aud" }),
			),
		).toBeNull();
	});

	it("names the issuer without a trailing slash and the audience", () => {
		expect(
			operatorAccess(
				readConfig({
					...env,
					ACCESS_ISSUER: "https://team.example/",
					ACCESS_AUD: "aud-1",
				}),
			),
		).toEqual({ issuer: "https://team.example", aud: "aud-1" });
	});
});
