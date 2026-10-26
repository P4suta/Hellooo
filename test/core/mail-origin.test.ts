import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { normalizeEmailAddress } from "../../src/core/email-address.ts";
import {
	type Header,
	type Origin,
	originProblem,
} from "../../src/core/mail-origin.ts";
import type { EmailAddress } from "../../src/core/types.ts";
import { must } from "../support/must.ts";

const address = (raw: string): EmailAddress => must(normalizeEmailAddress(raw));
const WRITER = address("writer@example.com");
const OWN = [
	address("letters@service.example"),
	address("post@service.example"),
];

const personal: Origin = {
	envelopeFrom: WRITER,
	headerFrom: WRITER,
	ownAddresses: OWN,
	headers: [
		{ key: "from", value: "Writer <writer@example.com>" },
		{ key: "subject", value: "Hellooo" },
	],
};

function withHeaders(...headers: Header[]): Origin {
	return { ...personal, headers: [...personal.headers, ...headers] };
}

describe("originProblem", () => {
	it("accepts a plain personal mail", () => {
		expect(originProblem(personal)).toBeNull();
		expect(
			originProblem(withHeaders({ key: "auto-submitted", value: " No " })),
		).toBeNull();
		expect(
			originProblem(withHeaders({ key: "precedence", value: "first-class" })),
		).toBeNull();
		expect(
			originProblem(
				withHeaders(
					{ key: "subject", value: "bulk" },
					{ key: "x-priority", value: "list" },
					{ key: "comments", value: "auto-replied" },
				),
			),
		).toBeNull();
	});

	it("refuses mail the service sent itself", () => {
		for (const own of OWN) {
			expect(
				originProblem({ ...personal, envelopeFrom: own, headerFrom: own }),
			).toBe("own-address");
		}
	});

	it("refuses an envelope sender the From header does not confirm", () => {
		expect(
			originProblem({ ...personal, headerFrom: address("other@example.org") }),
		).toBe("misaligned-from");
		expect(originProblem({ ...personal, headerFrom: null })).toBe(
			"misaligned-from",
		);
	});

	it.each(["auto-replied", "auto-generated", "AUTO-REPLIED", "yes"])(
		"refuses Auto-Submitted: %s",
		(value) => {
			expect(originProblem(withHeaders({ key: "auto-submitted", value }))).toBe(
				"auto-submitted",
			);
		},
	);

	it.each(["list-id", "list-post", "list-unsubscribe"])(
		"refuses mail that carries %s",
		(key) => {
			expect(originProblem(withHeaders({ key, value: "<x.example>" }))).toBe(
				"mailing-list",
			);
		},
	);

	it.each(["bulk", "list", "junk", " Bulk "])(
		"refuses Precedence: %s",
		(value) => {
			expect(originProblem(withHeaders({ key: "precedence", value }))).toBe(
				"bulk",
			);
		},
	);

	it("names the first problem in a fixed order", () => {
		expect(
			originProblem({
				...withHeaders({ key: "list-id", value: "x" }),
				headerFrom: null,
			}),
		).toBe("misaligned-from");
		expect(
			originProblem(
				withHeaders(
					{ key: "precedence", value: "bulk" },
					{ key: "auto-submitted", value: "auto-replied" },
				),
			),
		).toBe("bulk");
	});

	it("never names a problem for headers outside the watched set", () => {
		const watched = new Set([
			"auto-submitted",
			"list-id",
			"list-post",
			"list-unsubscribe",
			"precedence",
		]);
		fc.assert(
			fc.property(
				fc.array(
					fc.record<Header>({
						key: fc.string().filter((key) => !watched.has(key)),
						value: fc.string(),
					}),
				),
				(headers) => originProblem({ ...personal, headers }) === null,
			),
		);
	});
});
