import { z } from "zod";
import type { ModerationVerdict } from "../core/intake-decision.ts";
import {
	MODERATION_QUESTIONS,
	type ModerationQuestion,
	QUESTIONS,
	verdictFromProbabilities,
} from "../core/moderation-verdict.ts";
import type { Config } from "./env.ts";

const AnswersSchema = z.object({
	answers: z.record(
		z.string(),
		z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) }),
	),
});

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** The request body TypeSafe's Jev accepts: one yes/no question per moderation rule, answered with a probability. */
export function jevRequest(
	model: string,
	letter: string,
): Record<string, unknown> {
	return {
		model,
		state: letter,
		questions: Object.fromEntries(
			QUESTIONS.map((id) => [
				id,
				{ type: "noul", instructions: MODERATION_QUESTIONS[id] },
			]),
		),
	};
}

/**
 * One HTTPS call to a Jev-compatible endpoint, which returns probabilities instead of text.
 * A missing key, an unavailable service, or an answer in an unexpected shape yields no verdict, so the letter waits for a later attempt.
 */
export async function moderateWithJev(
	config: Config,
	letter: string,
	fetchImpl: Fetch = fetch,
): Promise<ModerationVerdict | null> {
	if (config.TYPESAFE_API_KEY === undefined) {
		console.error("TYPESAFE_API_KEY is not set, the letter waits");
		return null;
	}
	try {
		const response = await fetchImpl(config.MODERATION_ENDPOINT, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${config.TYPESAFE_API_KEY}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(jevRequest(config.MODERATION_MODEL, letter)),
		});
		if (!response.ok) {
			throw new Error(`the decision model answered ${response.status}`);
		}
		const { answers } = AnswersSchema.parse(await response.json());
		const probabilities = Object.fromEntries(
			QUESTIONS.map((id) => {
				const answer = answers[id];
				if (answer === undefined) {
					throw new Error(`the decision model skipped the question ${id}`);
				}
				return [id, answer.noul];
			}),
		) as Record<ModerationQuestion, number>;
		return verdictFromProbabilities(probabilities);
	} catch (error) {
		console.warn(
			"moderation unavailable, the letter waits",
			error instanceof Error ? error.message : String(error),
		);
		return null;
	}
}
