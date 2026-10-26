import type { ModerationVerdict } from "./intake-decision.ts";

/** Yes/no questions the decision model answers with a probability; a likely yes to any of them refuses the letter. */
export const MODERATION_QUESTIONS = {
	sells:
		"Does the letter advertise, sell, solicit, recruit, or ask for money, clicks, or contact?",
	harasses:
		"Does the letter harass, threaten, demean, or incite hatred against a person or a group?",
	sexual: "Is the letter sexually explicit?",
	exposes:
		"Does the letter expose someone's private or identifying information?",
	illegal: "Does the letter describe, request, or facilitate an illegal act?",
	spam: "Is the letter spam or meaningless filler rather than a message to a person?",
	targetsPerson:
		"Does the letter address, accuse, or describe a specific named real person?",
} as const;

export type ModerationQuestion = keyof typeof MODERATION_QUESTIONS;
export type Probabilities = Readonly<Record<ModerationQuestion, number>>;

export const QUESTIONS = Object.keys(
	MODERATION_QUESTIONS,
) as readonly ModerationQuestion[];

/** A yes at least this likely, to any question, refuses the letter. */
export const REJECT_AT = 0.5;

export function verdictFromProbabilities(
	probabilities: Probabilities,
): ModerationVerdict {
	return QUESTIONS.some((question) => probabilities[question] >= REJECT_AT)
		? "reject"
		: "deliver";
}
