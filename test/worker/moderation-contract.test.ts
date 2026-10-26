import fc from "fast-check";
import { describe, it } from "vitest";
import { jevRequest } from "../../src/worker/moderation.ts";

/** Limits from TypeSafe's API reference: question ids are letters, digits, `_`, `.`, `-`, up to 100 characters, 1 to 64 per request. */
const QUESTION_ID = /^[A-Za-z0-9_.-]{1,100}$/;
const MAX_QUESTIONS = 64;

type Request = {
	readonly model: string;
	readonly state: string;
	readonly questions: Record<
		string,
		{ readonly type: string; readonly instructions: string }
	>;
};

describe("the moderation request", () => {
	it("stays within the documented shape for any letter", () => {
		fc.assert(
			fc.property(
				fc.string({ unit: "grapheme" }),
				fc.string({ minLength: 1 }),
				(letter, model) => {
					const request = jevRequest(model, letter) as Request;
					const ids = Object.keys(request.questions);
					return (
						request.model === model &&
						request.state === letter &&
						ids.length >= 1 &&
						ids.length <= MAX_QUESTIONS &&
						ids.every((id) => QUESTION_ID.test(id)) &&
						Object.values(request.questions).every(
							(q) => q.type === "noul" && q.instructions.trim().length > 0,
						)
					);
				},
			),
		);
	});

	it("survives a JSON round trip unchanged", () => {
		fc.assert(
			fc.property(fc.string({ unit: "grapheme" }), (letter) => {
				const request = jevRequest("jev-latest", letter);
				return (
					JSON.stringify(JSON.parse(JSON.stringify(request))) ===
					JSON.stringify(request)
				);
			}),
		);
	});
});
