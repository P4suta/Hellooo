---
date: 2026-10-26
status: Accepted
---

# Gate every change fast and release candidates heavily

## Status

Accepted.

## Context

The project has a fast local gate, `just check`, and four heavy checks: the Lean proofs with their conformance vectors, the mutation campaign, and the end-to-end run against `cf dev`.
The heavy checks take minutes and need toolchains beyond Node, so they cannot run on every commit without slowing every change.
Dependencies, actions, and tool versions drift, and a hard-coded address or line of copy has already cost one round of edits across tests.

## Decision

- The hosted workflow `check` runs `just check` on one pinned Linux runner for every pull request and merge group, cancels a superseded run of the same ref, and exposes one `summary` job as the required check.
- The hosted workflow `release gate` runs by hand on a candidate commit: `just check`, the Lean build through the pinned toolchain, a regeneration of the conformance vectors that refuses drift, the mutation campaign, and the end-to-end run.
- Every action is pinned to a commit with its version in a comment, checkouts persist no credentials, expressions never reach a shell unquoted, and the runner installs the tools that `.mise.toml` pins, including `just`.
- Renovate extends the owner's shared preset, which groups non-major updates, pins action digests, maintains the lockfile, and merges minor and patch updates after the fast gate passes.
- Lefthook runs Biome on staged files and the type check before a commit, and the full fast gate before a push.
- A guard test reads the addresses and the domain from `cloudflare.config.ts` and fails when any source or test file spells one of them out, so a change of address or domain is one edit; tests take copy from the message catalog and addresses from `readConfig`.
- The web adapter sends `Cache-Control: no-store`, `Referrer-Policy: same-origin`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and a content security policy that allows only the page's own inline style, because every page carries a token or is tiny.

## Consequences

- A pull request waits for the fast gate only; a release waits for the heavy checks on the exact candidate commit.
- The hosted workflows exist before the repository does, so their first run on GitHub is the check of their own wiring.
- `tools/design-copy.ts` prints the catalog and the service facts for the design, so the Figma file is built from the same source as the Worker rather than from copied text.

## Alternatives rejected

- Running the proofs and the mutation campaign on every pull request would cost minutes per change and tie the fast gate to toolchains the change may not touch.
- A `schedule` trigger for drift would duplicate what Renovate's pull requests already run through the fast gate.
