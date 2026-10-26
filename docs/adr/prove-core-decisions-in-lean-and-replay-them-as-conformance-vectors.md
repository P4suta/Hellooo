---
date: 2026-10-26
status: Accepted
---

# Prove the core decisions in Lean and replay them as conformance vectors

## Status

Accepted.

## Context

The pure core in `src/core` decides everything that matters for trust and money: who gets a reply, who is registered, when a letter is capped, when moderation runs, how credits move, who may receive, and how long a journey lasts.
Tests sample these decisions, and mutation testing shows that the tests notice broken code, but a sample proves nothing about the inputs it never drew.
No maintained verifier checks TypeScript semantics directly, so a proof needs a model, and a model needs an explicit link to the code that runs.
The owner's machines run Lean only inside a bounded container, and every contributor must get the same verdict from the pinned toolchain.

## Decision

- Each core decision has a model in `proofs/Hellooo/*.lean`, written one function to one function against the TypeScript, with the same constants, the same branch order, and integers where the code holds integers.
- The theorems state the promised properties and `lake build` checks them with the pinned toolchain in `proofs/lean-toolchain`: credit conservation and non-negativity over every reachable ledger, the weekly cap's decision and next allowed time, the bounds of the rejection limit, the silence of an unauthenticated mail, the fixed priority of cap, rejection limit, text check, and moderation, the moderation thresholds and their monotonicity, the alignment and automatic-mail conditions of a handled mail, recipient eligibility, order, and index bound, and the journey clamp bounds.
- `proofs/Hellooo/Axioms.lean` prints the axioms of the main theorems under `#guard_msgs`, so a proof that comes to rest on `sorryAx` or a new axiom fails the build.
- `proofs/Vectors.lean` evaluates the verified models over their whole abstract input domains and writes `proofs/vectors/*.json`; `test/core/conformance.test.ts` replays every vector against the TypeScript functions, which binds each theorem to the implementation on the inputs that distinguish the branches.
- Where the model abstracts a representation, the abstraction is stated and tested at its boundary: probabilities are basis points where the code compares doubles, the uniform is a dyadic fraction where the code floors a double, instants are unbounded integers where the code keeps safe integers, and the log-normal draw stays outside the model while its clamp is exported and proved.
- `just proofs` runs the build and regenerates the vectors with a native toolchain, and `just proofs-bounded <image>` runs the same commands in the owner's bounded container; both belong to the release gate `just release-gate`, never to the commit or pull-request gate.

## Consequences

- A changed decision rule fails either a theorem or a conformance vector before it ships, and the failure names the branch.
- String processing stays outside the proofs: address normalization, the `Authentication-Results` parser, the letter text checks, HTML to text, and locale negotiation have Unicode and regular-expression semantics that the model does not cover, so property tests, adversarial-length tests, fuzzing, and the mutation campaign carry them, and the disposition is revisited when a verifier with JavaScript semantics becomes available.
- The adapters' external semantics stay outside the proofs: D1 batch atomicity, Cloudflare's reply and sending behaviour, and the decision model's answers are covered by the D1 integration and model-based tests, the end-to-end run against `cf dev`, the request contract tests, and the real-mail checks planned before launch.
- The theorem that the rejection limit never exceeds three needs the count of rejections to be non-negative, which the proof made explicit and the database query guarantees.
- The vectors are committed artifacts, so a model change without regeneration fails the conformance test rather than passing silently.

## Alternatives rejected

- Translating the core to a verified language and compiling it to JavaScript would remove the model gap but replace the readable TypeScript core with generated code and a second toolchain in the Worker build.
- Model checking the delivery protocol with a bounded checker would cover interleavings only up to a bound; the Lean `Reachable` induction covers every sequence of the atomic ledger operations, and the per-letter reservation protocol stays a candidate for a later model.
- Proving properties only as fast-check properties would keep them as samples; the properties remain in place as a second, independently written statement of the same laws.
