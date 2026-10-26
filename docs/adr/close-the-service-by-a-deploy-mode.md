---
date: 2026-10-26
---

# Close the service by a deploy mode

## Status

Accepted

## Context

The service went live before its terms and privacy notice had a legal review, and the operator asked to take it off the public internet until that review is done.
The stop had to take minutes, keep the Worker, the database, the domain, and the configuration in place, and be undone by one ordinary deploy.
The Cloudflare CLI offers no single command that detaches the custom domain, removes the cron trigger, and silences the email trigger at once.

## Decision

The Worker carries a `SERVICE_CLOSED` variable that only the `closed` deploy mode sets to `true`.
Closed, every page answers `503` with a one-line notice in both languages, incoming mail is ignored without a reply, and the scheduled run does nothing.
`just close` publishes that mode, and `just deploy` publishes the open service again.
Disabling the Email Routing rule for the letters address is a separate, independent stop that the operator applies by hand.

## Consequences

- Closing and opening are deploys of the same code, so the stop is reviewed, tested, and reversible like any change.
- A letter that arrives while the service is closed is lost without a reply, because the closed service makes no promise to anyone.
- The data stays, so the people who registered before the stop keep their state when the service opens again.

## Alternatives rejected

- Deleting the Worker: reversible by a deploy, but the custom domain, the cron trigger, and the mail rule would have to be re-created and verified, and nothing would answer on the domain meanwhile.
- Removing only the custom domain and the triggers through the API: three separate operations without a command in the CLI, and nothing records that the service is closed.
