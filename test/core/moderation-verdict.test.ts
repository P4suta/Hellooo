import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
	MODERATION_QUESTIONS,
	type Probabilities,
	QUESTIONS,
	REJECT_AT,
	verdictFromProbabilities,
} from "../../src/core/moderation-verdict.ts";

const quiet = (): Probabilities =>
	Object.fromEntries(QUESTIONS.map((q) => [q, 0])) as Probabilities;
const probability = fc.double({ min: 0, max: 1, noNaN: true });
const probabilities = fc
	.array(probability, {
		minLength: QUESTIONS.length,
		maxLength: QUESTIONS.length,
	})
	.map(
		(values) =>
			Object.fromEntries(
				QUESTIONS.map((q, i) => [q, values[i] ?? 0]),
			) as Probabilities,
	);

describe("moderation questions", () => {
	it("are all yes/no questions in English", () => {
		for (const question of Object.values(MODERATION_QUESTIONS)) {
			expect(question.endsWith("?")).toBe(true);
			expect(/^(Does|Is)\b/.test(question)).toBe(true);
		}
	});

	it("name every rule once", () => {
		expect([...QUESTIONS].sort()).toEqual(
			[
				"sells",
				"harasses",
				"sexual",
				"exposes",
				"illegal",
				"spam",
				"targetsPerson",
			].sort(),
		);
		expect(REJECT_AT).toBeGreaterThan(0);
		expect(REJECT_AT).toBeLessThanOrEqual(1);
	});
});

describe("verdictFromProbabilities", () => {
	it("delivers a quiet letter", () => {
		expect(verdictFromProbabilities(quiet())).toBe("deliver");
	});

	it.each(QUESTIONS)(
		"rejects at the threshold on %s and delivers just below it",
		(question) => {
			expect(
				verdictFromProbabilities({ ...quiet(), [question]: REJECT_AT }),
			).toBe("reject");
			expect(
				verdictFromProbabilities({
					...quiet(),
					[question]: REJECT_AT - Number.EPSILON,
				}),
			).toBe("deliver");
		},
	);

	it("rejects exactly when some question reaches the threshold", () => {
		fc.assert(
			fc.property(probabilities, (p) => {
				const expected = QUESTIONS.some((q) => p[q] >= REJECT_AT)
					? "reject"
					: "deliver";
				expect(verdictFromProbabilities(p)).toBe(expected);
			}),
		);
	});

	it("never turns a refusal into a delivery when probabilities rise", () => {
		fc.assert(
			fc.property(probabilities, probabilities, (p, extra) => {
				const raised = Object.fromEntries(
					QUESTIONS.map((q) => [q, Math.min(1, p[q] + extra[q])]),
				) as Probabilities;
				if (verdictFromProbabilities(p) === "reject") {
					expect(verdictFromProbabilities(raised)).toBe("reject");
				}
			}),
		);
	});
});
