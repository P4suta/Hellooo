---
date: 2026-10-25
status: Partly superseded
---

# Moderate letters with a decision model instead of a text model

## Status

Partly superseded by [decide-every-letter-by-the-model-and-retry-while-it-is-unavailable.md](decide-every-letter-by-the-model-and-retry-while-it-is-unavailable.md), which removes the review tier and the self-harm question; the decision model, the endpoint, and the adapter stand.

## Context

Every accepted letter reaches a stranger, so the service refuses advertising, harassment, sexual content, exposed personal data, illegal content, and spam before a letter travels.
A text-generating model can classify a letter, but it needs a prompt that asks for structured output and parsing of the answer.
TypeSafe's Jev answers typed yes/no, choice, and score questions with probabilities and generates no text, through one HTTPS endpoint and one API key.
Cloudflare's Clef models accept the same request shape on Workers AI through the Worker's own binding.

## Decision

- Moderation asks Jev one yes/no question per rule and reads one probability per question.
- `src/core/moderation-verdict.ts` holds the questions and turns the probabilities into a verdict: any refusing rule at or above `REJECT_AT` rejects, any question at or above `REVIEW_AT` holds the letter for a person, and everything below delivers.
- Self-harm and a named real person only ever hold a letter, never refuse it.
- The adapter in `src/worker/moderation.ts` calls `https://api.typesafe.ai/v1/systemone` with the secret `TYPESAFE_API_KEY`, declared in `cloudflare.config.ts` and supplied by Doppler at run time, validates the answer, and holds the letter when the key is missing, the service is unavailable, or the answer has an unexpected shape.
- The model name is configuration (`MODERATION_MODEL`, `jev-latest`), and Clef can replace Jev by swapping the adapter's transport for the Workers AI binding without a change to the rules.

## Consequences

- One external secret exists in the deployment, and the letter never leaves the service except for this call.
- The thresholds are two named numbers with property tests, and tuning them needs no prompt engineering.
- The questions are English prose read by the model, and the letters may be in any language, so a sample of real letters in each expected language belongs in the launch checklist.
- Probabilities are model judgments and can be wrong, so reports from recipients remain the second line of defense.

## Alternatives rejected

- A text model with structured output, which the first design used, costs a prompt and a parsing step for the same decision.
- Clef on Workers AI needs no external key, and the owner chose Jev; the request shape is shared, so the choice stays reversible.
- Keyword lists alone miss paraphrased solicitation and harassment and refuse ordinary letters that mention money or anger.
- No moderation at all leaves the operator liable for what strangers receive.
