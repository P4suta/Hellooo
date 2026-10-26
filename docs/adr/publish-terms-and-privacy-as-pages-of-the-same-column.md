---
date: 2026-10-26
status: Accepted
---

# Publish terms and privacy as pages of the same column

## Status

Accepted.

## Context

The service takes addresses and private letters from the public, and it published neither terms of use nor a privacy notice.
A reader had no way to learn what the service keeps, for how long, who else receives a letter, or how to have their data removed, and the operator had nothing to point a question at.
The pages are legal text, but the site has one voice and one column, and the facts the text names already live in the configuration and the core.

## Decision

- `/terms` and `/privacy` are two pages in the visitor's language, rendered in the same column as every other page, with one heading per section and plain lines under it.
- The text lives in `src/core/legal.ts` as pure functions of the facts: the service name, the operator, the contact address, and the jurisdiction; the retention period comes from the erasure constant and the processors are named once.
- The jurisdiction is an ISO 3166-1 alpha-2 code in the configuration, and each language spells it out through the runtime's region names, so no page carries a country's name in its text.
- The privacy notice states the stored data, the purposes, the ninety-day erasure of letter text after a letter settles, the two processors, what the operator can read, that the pages set no cookies and run no scripts, and the address that handles removal requests.
- The terms state what a letter may not contain, that delivery is not promised, how reports and bans work, how to stop, and that the service comes free and without warranty under the configured jurisdiction's law.
- The front page links to both pages beside the operator line, and the tests keep both languages complete and the facts woven in.

## Consequences

- A reader can read the retention and the processors that the implementation enforces, and the two stay in step because the page reads the constants.
- A removal request is handled by the operator by hand through the contact address; the service has no self-service deletion beyond the stop.
- Review of the wording by a professional stays with the operator, and the jurisdiction changes in one configuration value.

## Alternatives rejected

- Linking to a document hosted elsewhere would put the service's own promises outside its voice and its tests.
- A single combined page would mix two readers' questions and grow past one column.
- Hard-coding the country in each language's text would split one fact across two catalogs.
