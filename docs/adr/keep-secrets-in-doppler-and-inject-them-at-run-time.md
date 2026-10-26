---
date: 2026-10-26
status: Accepted
---

# Keep secrets in Doppler and inject them at run time

## Status

Accepted.

## Context

The Worker needs one secret today, the TypeSafe key for moderation, and will need more as sending and reporting grow.
Until now the key lived in a plaintext `.dev.vars` file for `cf dev` and was uploaded with `cf deploy --secrets-file`, so every machine that runs or deploys the service held a copy on disk.
The owner keeps secrets in a Doppler workplace and runs the Doppler CLI through mise.

## Decision

- Doppler is the only store for secrets; the repository holds names and the project mapping, never values.
- `doppler.yaml` names the Doppler project `hellooo` and its default config `dev`, so `doppler setup` binds a checkout without prompts.
- `just dev` runs `cf dev` under `doppler run`, which injects the secrets as environment variables that the Vite plugin reads as secret bindings.
- `just deploy` runs `cf deploy --secrets-file` against a Doppler mount that is read once and never written to disk, with `--no-fallback` so a cached copy cannot stand in for a failed fetch, and takes the Doppler config as its argument with `prd` as the default.
- Tests keep their fixed test-only values in `vitest.config.ts` and in the end-to-end setup, so no gate depends on Doppler.
- A missing or empty secret fails loudly: `readConfig` keeps `TYPESAFE_API_KEY` optional only so that the moderation adapter can hold a letter instead of guessing, and the deploy recipe refuses an empty mount through the CLI's own missing-secret exit.

## Consequences

- No plaintext secrets file exists in the checkout, and `.gitignore` keeps refusing one in case a tool writes it.
- A contributor needs `doppler login` once and `doppler setup` per clone; the README's usage lists both.
- Continuous integration, when it exists, authenticates with Doppler OIDC or a scoped read-only service token as the Doppler skill describes, rather than with copied values.
- Each new secret is one name in `cloudflare.config.ts` and one key in the Doppler project, which keeps the inventory in two places that can be compared.

## Alternatives rejected

- Cloudflare's own secret store through `cf secret put` would hold production values but leaves local development with a plaintext file and no shared inventory.
- Encrypting `.dev.vars` in the repository keeps a copy in every clone and needs its own key distribution.
