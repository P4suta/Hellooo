import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { normalizeEmailAddress } from "../../src/core/email-address.ts";

describe("normalizeEmailAddress", () => {
	it("lowercases and trims a plain address", () => {
		expect(normalizeEmailAddress("  Me@Example.COM ")).toBe("me@example.com");
		expect(normalizeEmailAddress("First.Last+tag@sub.Example.co.jp")).toBe(
			"first.last+tag@sub.example.co.jp",
		);
	});

	it.each([
		"",
		"me",
		"me.example.com",
		"example.com",
		"@example.com",
		"me@",
		"me@localhost",
		"me @example.com",
		"a@b@c.com",
		"a@.com",
		"a@com.",
		"a@-example.com",
		"a@example-.com",
		"a@exa_mple.com",
		".a@example.com",
		"a.@example.com",
		"a..b@example.com",
		'"quoted"@example.com',
		"a<b@example.com",
		"a@例え.jp",
		"a@K.com",
		"ａ@example.com",
		`${"x".repeat(65)}@example.com`,
		`a@${"b".repeat(250)}.com`,
	])("rejects %j", (raw) => {
		expect(normalizeEmailAddress(raw)).toBeNull();
	});

	it("accepts a 64 character local part and a 63 character label", () => {
		expect(normalizeEmailAddress(`${"x".repeat(64)}@example.com`)).toBe(
			`${"x".repeat(64)}@example.com`,
		);
		expect(normalizeEmailAddress(`a@${"b".repeat(63)}.com`)).toBe(
			`a@${"b".repeat(63)}.com`,
		);
		expect(normalizeEmailAddress(`a@${"b".repeat(64)}.com`)).toBeNull();
	});

	it("accepts 254 characters in all and rejects 255", () => {
		const local = "x".repeat(64);
		const longest = `${local}@${["a".repeat(63), "b".repeat(63), "c".repeat(57), "com"].join(".")}`;
		expect(longest).toHaveLength(254);
		expect(normalizeEmailAddress(longest)).toBe(longest);
		const tooLong = `${local}@${["a".repeat(63), "b".repeat(63), "c".repeat(58), "com"].join(".")}`;
		expect(tooLong).toHaveLength(255);
		expect(normalizeEmailAddress(tooLong)).toBeNull();
	});

	it("accepts one character labels and local parts", () => {
		expect(normalizeEmailAddress("a@b.io")).toBe("a@b.io");
		expect(normalizeEmailAddress("a@b.c")).toBe("a@b.c");
	});

	it("is idempotent on every accepted address", () => {
		fc.assert(
			fc.property(fc.emailAddress(), (raw) => {
				const once = normalizeEmailAddress(raw);
				return once === null || normalizeEmailAddress(once) === once;
			}),
		);
	});

	it("never accepts whitespace, uppercase, or a second at sign", () => {
		fc.assert(
			fc.property(fc.string(), (raw) => {
				const address = normalizeEmailAddress(raw);
				return (
					address === null ||
					(!/\s/.test(address) &&
						address === address.toLowerCase() &&
						address.split("@").length === 2 &&
						/^[^@]+@[^@]+\.[^@.]+$/.test(address))
				);
			}),
		);
	});

	it("is insensitive to surrounding whitespace and case", () => {
		fc.assert(
			fc.property(fc.emailAddress(), (raw) => {
				const plain = normalizeEmailAddress(raw);
				const dressed = normalizeEmailAddress(`  ${raw.toUpperCase()}\t`);
				return plain === dressed;
			}),
		);
	});
});
