---
date: 2026-10-26
status: Accepted
---

# Enforce the weekly cap when a letter is accepted

## Status

Accepted.
Extends [email-only-participation-with-dmarc-gated-identity.md](email-only-participation-with-dmarc-gated-identity.md), which sets one letter per rolling week.

## Context

The cap was checked once, when a mail arrived, against the sender's last accepted letter.
Several letters can wait between that check and their acceptance: letters that wait for a verification or a confirmation link, and letters that wait for the model.
A sender could store five unsigned letters in one day, open all five confirmation links, and have five letters accepted, which also granted five credits and broke the credit law.

## Decision

- Acceptance is one conditional update: a letter becomes traveling only while its sender has no other letter accepted within the week, and the credit and the event follow only when that update changed a row.
- A letter that loses the race is lost, its confirmation link stops working, and the event names the cap.
- The writer hears the same over-cap notice as for a letter refused at arrival, with the next allowed time, by reply at arrival or by mail on a scheduled run.
- The check at arrival stays, so most writers hear of the cap at once and no letter is stored for nothing.

## Consequences

- The credit law holds whatever the order and timing of links and model answers; the model-based invariant test refuses a credit for a letter the database refused.
- A writer who confirms two letters in one week keeps the first and loses the second, as the arrival check would have told them.
- `acceptLetter` answers whether it accepted, and the admission step turns a refusal into the over-cap outcome.

## Alternatives rejected

- Checking the cap in the adapter before the update would leave the window between the read and the write.
- Storing only one waiting letter per sender would refuse a second letter at arrival for a reason the writer could not see.
