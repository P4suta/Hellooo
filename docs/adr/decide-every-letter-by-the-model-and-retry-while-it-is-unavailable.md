---
date: 2026-10-26
status: Accepted
---

# Decide every letter by the model and retry while it is unavailable

## Status

Accepted.
Partly supersedes [moderate-letters-with-a-decision-model.md](moderate-letters-with-a-decision-model.md): the questions, the endpoint, and the adapter stay, and the review tier goes.

## Context

The first moderation design had three outcomes: deliver, refuse, and hold for a person when the model's probability fell between two thresholds or the model could not be asked.
Holding needed an operator queue of unreported letters, a mail telling the writer that a person was reading their letter, and copy explaining a step that exists only inside the service.
The owner found a queue of unreported letters senseless and the explanation of it leaking the internals, and the service should not depend on a person reading mail on time.

## Decision

- The model's verdict is binary: a yes at least as likely as `REJECT_AT` to any question refuses the letter, and anything below delivers it; the two questions that could only ever hold a letter go, except that a letter aimed at a named real person now refuses.
- When the model cannot be asked, because the key is missing, the service is down, or the answer has an unexpected shape, the letter is stored as waiting and the writer hears the same acceptance as for any taken letter.
- Every scheduled run asks the model again about the waiting letters, a batch at a time, oldest first; an accepted letter goes out without another mail, and a refused one sends the usual refusal mail.
- No person reads a letter before it goes out; the operator's page shows the numbers and the reported letters only.
- `decideAfterModeration` in `src/core/intake-decision.ts` takes the verdict or its absence, with a Lean model and conformance vectors; `src/worker/retry.ts` is the scheduled adapter.

## Consequences

- A writer never learns that the model was away, and a letter waits at most as long as the model is away plus one run.
- Letters the model doubts now go out or are refused by the single threshold, so the threshold carries the whole judgment and the reports from readers remain the correction.
- The operator's work is reports alone.
- A run stops asking at the first letter the model leaves unanswered, so an outage costs one timeout per run rather than one per held letter, and delivery and erasure still run.

## Alternatives rejected

- Refusing the letter when the model is away would make writers resend for a fault of the service.
- Delivering without a verdict would let the model's absence become a hole in moderation.
- Keeping a human review tier would keep the queue the owner refused.
