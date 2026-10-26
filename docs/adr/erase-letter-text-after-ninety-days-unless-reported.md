---
date: 2026-10-26
status: Accepted
---

# Erase letter text after ninety days unless reported

## Status

Accepted.

## Context

A letter is private writing from one stranger to another, and the service stored its text for as long as the row existed.
The text serves two purposes after the letter settles: a reader may report it, and the operator must then read what was reported.
Letters that never settle also piled up: one nobody confirmed through its link kept its text with no end.
A privacy policy needs a stated retention, and the plan listed the deletion of letter text as the one storage decision still open.

## Decision

- A letter's text is kept while the letter is on its way or waiting for the model's verdict, whatever its age.
- Once a letter has settled, by delivery, refusal, or loss, its text is erased ninety days later, counted from the delivery for a delivered letter and from the arrival for the rest.
- A letter whose report is open keeps its text past that day, and loses it in the run after the operator closes the report.
- A letter that nobody confirmed within ninety days of its arrival is given up: its text goes, it is marked lost, and its confirmation link stops working, so the verification page shows the next letter goes out rather than an empty one.
- A report that arrives after the erasure is still recorded; the operator's page shows that the text is no longer kept, with the count and the ban control.
- The scheduled run erases after it has delivered, in one transaction with the event that records each erasure; `erased_at` on the letter says when, and the body is empty from then on.
- The decision is `eraseBody` in `src/core/erasure.ts`, with the retention period as one named constant, a Lean model with the theorems `eraseBody_iff`, `eraseBody_monotone`, `eraseBody_of_keepsText`, and `eraseBody_of_reported`, conformance vectors around the end of the period, and an integration test that replays the decision against the SQL for every status.

## Consequences

- The service holds a letter's text for at most ninety days after it settles, plus the time a report stays open, which a privacy policy can state.
- A reader who reports a letter more than ninety days after receiving it is still heard, but the operator decides on the report count alone.
- Addresses, credits, deliveries, and events stay, so the credit law and the weekly cap are untouched by erasure.
- Changing the period means changing one constant and the vectors the proofs regenerate.
- Banning a writer closes every open report on their letters, and the operator page lists open reports whatever became of the writer, so no reported text waits for a closure nobody would record.

## Alternatives rejected

- Keeping text forever would leave the operator holding every private letter ever written through the service.
- Erasing at delivery would leave the operator nothing to read when a letter is reported.
- A shorter period for refused letters would add a second constant for text nobody can report or read anyway.
- Deleting the rows instead of the text would break the counts, the credit law, and the report links.
