import { describe, expect, it } from "vitest";
import configuration from "../../cloudflare.config.ts";

/**
 * The addresses and the domain live in cloudflare.config.ts and reach the code through bindings and tests through `readConfig`.
 * This guard fails the gate when any source or test file spells one of them out, so a change of address or domain is one edit.
 */

type Binding = { readonly value?: string } | string;
type Env = Record<string, Binding>;

const resolved =
	typeof configuration === "function"
		? (configuration as (context: { mode: string }) => unknown)({
				mode: "production",
			})
		: configuration;
const env = (resolved as { worker: { env: Env } }).worker.env;

function text(name: string): string {
	const binding = env[name];
	const value = typeof binding === "string" ? binding : binding?.value;
	if (value === undefined) {
		throw new Error(`cloudflare.config.ts declares no text binding ${name}`);
	}
	return value;
}

/** The mail domain, which the pages' host may extend with a label such as `www`. */
const mailDomain = text("LETTERS_ADDRESS").split("@")[1] ?? "";

const facts = [
	text("LETTERS_ADDRESS"),
	text("NOTICES_ADDRESS"),
	new URL(text("PUBLIC_BASE_URL")).host,
	mailDomain,
];

const sources = import.meta.glob<string>(
	["../../src/**/*.ts", "../../test/**/*.ts", "../../tools/**/*.ts"],
	{ query: "?raw", import: "default", eager: true },
);

describe("the service's addresses and domain", () => {
	it("are configured in cloudflare.config.ts and spelled out nowhere else", () => {
		const offenders: string[] = [];
		for (const [path, content] of Object.entries(sources)) {
			if (path.endsWith("/service-facts.test.ts")) {
				continue;
			}
			content.split("\n").forEach((line, index) => {
				for (const fact of facts) {
					if (line.includes(fact)) {
						offenders.push(`${path}:${index + 1}: ${fact}`);
					}
				}
			});
		}
		expect(offenders).toEqual([]);
	});

	it("names two different addresses on the mail domain, and pages on a host under it", () => {
		const [letters, post, host] = facts;
		expect(letters).not.toBe(post);
		expect(letters?.endsWith(`@${mailDomain}`)).toBe(true);
		expect(post?.endsWith(`@${mailDomain}`)).toBe(true);
		expect(host === mailDomain || host?.endsWith(`.${mailDomain}`)).toBe(true);
		expect(host).not.toBe(mailDomain);
	});
});
