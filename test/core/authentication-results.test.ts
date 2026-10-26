import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
	dmarcResult,
	withoutComments,
} from "../../src/core/authentication-results.ts";

const CLOUDFLARE_PASS =
	"mx.cloudflare.net; dkim=pass header.d=gmail.com header.s=20230601; spf=pass smtp.mailfrom=gmail.com; dmarc=pass (p=NONE sp=QUARANTINE dis=NONE) header.from=gmail.com";

describe("dmarcResult", () => {
	it("reads a pass from the receiving server's header", () => {
		expect(dmarcResult([CLOUDFLARE_PASS])).toBe("pass");
	});

	it("reads a fail", () => {
		expect(
			dmarcResult(["mx.cloudflare.net; dmarc=fail header.from=example.com"]),
		).toBe("fail");
	});

	it("treats any result other than pass as fail", () => {
		for (const result of ["temperror", "permerror", "none", "bestguesspass"]) {
			expect(
				dmarcResult([`mx.cloudflare.net; dmarc=${result} header.from=x`]),
			).toBe("fail");
		}
	});

	it("reports none when no header or no dmarc clause exists", () => {
		expect(dmarcResult([])).toBe("none");
		expect(dmarcResult([""])).toBe("none");
		expect(dmarcResult(["   "])).toBe("none");
		expect(
			dmarcResult(["mx.cloudflare.net; spf=pass smtp.mailfrom=example.com"]),
		).toBe("none");
		expect(dmarcResult(["mx.cloudflare.net; dmarc"])).toBe("none");
		expect(dmarcResult(["mx.cloudflare.net; dmarc="])).toBe("none");
	});

	it("trusts only the first header, which the last hop prepended", () => {
		expect(
			dmarcResult([
				"mx.cloudflare.net; dmarc=fail header.from=x",
				"attacker.example; dmarc=pass",
			]),
		).toBe("fail");
		expect(
			dmarcResult([
				"mx.cloudflare.net; spf=pass",
				"attacker.example; dmarc=pass",
			]),
		).toBe("none");
	});

	it("takes the first dmarc clause when one header carries several", () => {
		expect(
			dmarcResult(["mx.cloudflare.net; dmarc=fail header.from=x; dmarc=pass"]),
		).toBe("fail");
	});

	it("ignores case, comments, and folded whitespace", () => {
		expect(
			dmarcResult([
				"mx.cloudflare.net; DMARC=Pass (dmarc=fail inside a comment) header.from=x",
			]),
		).toBe("pass");
		expect(
			dmarcResult([
				"mx.cloudflare.net;\r\n\tdkim=pass;\r\n\tdmarc=pass header.from=x",
			]),
		).toBe("pass");
		expect(dmarcResult(["mx.cloudflare.net;dmarc=pass"])).toBe("pass");
	});

	it("does not read a dmarc word inside another token", () => {
		expect(dmarcResult(["mx.cloudflare.net; x-dmarc=pass"])).toBe("none");
		expect(dmarcResult(["mx.cloudflare.net; dmarcx=pass"])).toBe("none");
		expect(dmarcResult(["mx.cloudflare.net; dkim=pass dmarc=pass"])).toBe(
			"none",
		);
	});

	it("skips a comment that precedes the dmarc clause", () => {
		expect(
			dmarcResult([
				"mx.cloudflare.net; (received from 192.0.2.1) dmarc=pass header.from=x",
			]),
		).toBe("pass");
		expect(
			dmarcResult([
				"mx.cloudflare.net; dkim=pass (2048-bit key; unprotected) header.d=x; dmarc=fail",
			]),
		).toBe("fail");
	});

	it("reads only an exact pass", () => {
		expect(dmarcResult(["mx.cloudflare.net; dmarc=passed"])).toBe("fail");
		expect(dmarcResult(["mx.cloudflare.net; dmarc=pass2"])).toBe("fail");
	});

	it("always answers pass, fail, or none", () => {
		fc.assert(
			fc.property(fc.array(fc.string()), (headers) =>
				["pass", "fail", "none"].includes(dmarcResult(headers)),
			),
		);
	});

	it("answers pass only when the first header says so", () => {
		fc.assert(
			fc.property(fc.array(fc.string(), { minLength: 1 }), (headers) => {
				const [first = ""] = headers;
				return (
					dmarcResult(headers) !== "pass" ||
					/dmarc=pass/i.test(withoutComments(first))
				);
			}),
		);
	});

	it("ignores a dmarc clause written inside a comment, nested or not", () => {
		expect(dmarcResult(["mx.example; (dmarc=pass (really)) spf=pass"])).toBe(
			"none",
		);
		expect(dmarcResult(["mx.example; (dmarc=pass; ) dmarc=fail"])).toBe("fail");
	});
});

describe("withoutComments", () => {
	it("drops comments, nested ones included, and keeps the rest", () => {
		expect(withoutComments("a (b (c) d) e")).toBe("a  e");
		expect(withoutComments("dmarc=pass (p=NONE) header.from=x")).toBe(
			"dmarc=pass  header.from=x",
		);
	});

	it("lets an unclosed comment swallow the rest and keeps a stray close", () => {
		expect(withoutComments("a (b c")).toBe("a ");
		expect(withoutComments("a ) b")).toBe("a ) b");
	});

	it("never keeps a parenthesis that opened a comment, whatever the input", () => {
		fc.assert(
			fc.property(fc.string(), (value) => {
				const kept = withoutComments(value);
				return !kept.includes("(") && kept.length <= value.length;
			}),
		);
	});
});
