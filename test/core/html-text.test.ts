import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { HTML_SCAN_LIMIT, plainTextOfHtml } from "../../src/core/html-text.ts";

describe("plainTextOfHtml", () => {
	it("keeps the words, breaks the blocks, and drops scripts and styles", () => {
		const html =
			"<html><head><title>x</title><style>p{}</style></head><body><p>Hello &amp; welcome</p><div>line<br>two</div><script>alert(1)</script></body></html>";
		expect(plainTextOfHtml(html)).toBe("Hello & welcome\nline\ntwo\n");
	});

	it("breaks on self-closing and uppercase tags", () => {
		expect(plainTextOfHtml("one<BR/>two<br />three<P>four</P>")).toBe(
			"one\ntwo\nthreefour\n",
		);
	});

	it("breaks after every heading level", () => {
		for (const level of [1, 2, 3, 4, 5, 6]) {
			expect(plainTextOfHtml(`<h${level}>Title</h${level}>after`)).toBe(
				"Title\nafter",
			);
		}
	});

	it("closes a hidden element with or without whitespace before the bracket", () => {
		expect(plainTextOfHtml("a<script>x</script>b")).toBe("ab");
		expect(plainTextOfHtml("a<script>x</script\n>b")).toBe("ab");
		expect(plainTextOfHtml("<head><title>t</title></head >visible")).toBe(
			"visible",
		);
		expect(plainTextOfHtml("<head><title>t</title></head>visible")).toBe(
			"visible",
		);
	});

	it("breaks list items, headings, and table rows", () => {
		expect(
			plainTextOfHtml(
				"<h1>Title</h1><ul><li>a</li><li>b</li></ul><table><tr><td>c</td></tr></table>",
			),
		).toBe("Title\na\nb\nc\n");
	});

	it("decodes the common and numeric entities", () => {
		expect(plainTextOfHtml("&lt;a&gt; &quot;b&quot; &#39;c&#39;&nbsp;d")).toBe(
			`<a> "b" 'c' d`,
		);
		expect(plainTextOfHtml("&#x27;x&#x27; &#65;&#x1F600;")).toBe("'x' A😀");
		expect(plainTextOfHtml("&apos;y&apos; &AMP; &Lt;")).toBe("'y' & <");
		expect(plainTextOfHtml("&unknown; &#xZZ; &#;")).toBe(
			"&unknown; &#xZZ; &#;",
		);
	});

	it("decodes up to the last code point and keeps anything beyond it", () => {
		expect(plainTextOfHtml("&#x10FFFF;&#1114111;")).toBe(
			"\u{10FFFF}\u{10FFFF}",
		);
		expect(plainTextOfHtml("&#x110000; &#1114112;")).toBe(
			"&#x110000; &#1114112;",
		);
		expect(plainTextOfHtml(`&#${"9".repeat(400)};`)).toBe(
			`&#${"9".repeat(400)};`,
		);
	});

	it("treats a processing instruction and a tag named inside a comment as markup only", () => {
		expect(plainTextOfHtml('<?xml version="1.0"?>text')).toBe("text");
		expect(plainTextOfHtml("<!-- script output removed -->text")).toBe("text");
		expect(plainTextOfHtml("<!--[if mso]><style>x</style><![endif]-->t")).toBe(
			"t",
		);
	});

	it("leaves text without markup unchanged", () => {
		expect(plainTextOfHtml("plain text")).toBe("plain text");
		expect(plainTextOfHtml("")).toBe("");
	});

	it("keeps attribute content out of the text, even a quoted greater-than sign", () => {
		expect(
			plainTextOfHtml('<a href="https://example.com" title="x>y">link</a>'),
		).toBe("link");
		expect(plainTextOfHtml("<a title='x>y'>link</a>")).toBe("link");
	});

	it("keeps a less-than sign that never closes as text", () => {
		expect(plainTextOfHtml("1 < 2 and 3 > 2")).toBe("1 < 2 and 3 > 2");
		expect(plainTextOfHtml("<b>bold</b> then <unclosed")).toBe(
			"bold then <unclosed",
		);
	});

	it("drops a hidden element that never closes, together with its tail", () => {
		expect(plainTextOfHtml("before<script>alert(1)")).toBe("before");
		expect(
			plainTextOfHtml("before<style>p{}</style>after<STYLE>x</style>"),
		).toBe("beforeafter");
		expect(plainTextOfHtml("<script type='x'>a</script >b")).toBe("b");
	});

	it("ignores comments and declarations", () => {
		expect(plainTextOfHtml("<!doctype html><!-- note -->text")).toBe("text");
	});

	it("reads only the first part of an enormous document", () => {
		const far = `${"<b>".repeat(HTML_SCAN_LIMIT)}late`;
		expect(plainTextOfHtml(far)).not.toContain("late");
		const near = `early${"<i></i>".repeat(100)}`;
		expect(plainTextOfHtml(near)).toBe("early");
	});

	it("never leaves a tag behind when no entity could spell one", () => {
		fc.assert(
			fc.property(
				fc.string().map((s) => s.replaceAll("&", "")),
				(html) => !/<[a-zA-Z/!?][^<>]*>/.test(plainTextOfHtml(html)),
			),
		);
	});

	it("never exceeds the input in length", () => {
		fc.assert(
			fc.property(
				fc.string(),
				(html) => plainTextOfHtml(html).length <= html.length,
			),
		);
	});

	it("is idempotent", () => {
		fc.assert(
			fc.property(fc.string(), (html) => {
				const once = plainTextOfHtml(html);
				return plainTextOfHtml(once) === once || /[<&]/.test(once);
			}),
		);
	});
});
