set positional-arguments

pnpm := "mise x -- pnpm"
# Doppler holds every secret; `doppler setup` selects the project and config for this checkout from doppler.yaml.
doppler := "mise x -- doppler"
# The ephemeral file that `cf deploy` reads once; Doppler mounts it and nothing is written to disk.
secrets_mount := ".cloudflare/secrets.env"
# The id that cloudflare.config.ts gives the local D1 database, and the state directory that `cf dev` uses.
local_database := "00000000-0000-4000-8000-000000000001"
local_state := ".cloudflare/state"
local_intake := "http://127.0.0.1:5173/cdn-cgi/local/email"

# List the available recipes.
default:
    @just --list

# Apply the D1 migrations to the local database that `just dev` serves.
migrate-local:
    {{ pnpm }} exec cf d1 migrations apply {{ local_database }} --local --persist-to {{ local_state }}

# Run the Worker locally with hot reload, after applying local D1 migrations; Doppler injects the secrets of the selected config.
dev: migrate-local
    {{ doppler }} run -- {{ pnpm }} run dev

# Post a fixture letter to the local intake endpoint that `just dev` serves.
intake-sample fixture="test/fixtures/letter-with-dmarc-pass.eml" from="writer@example.com" to="anybody@hellooo.email":
    curl --fail --silent --show-error --request POST '{{ local_intake }}' --url-query 'from={{ from }}' --url-query 'to={{ to }}' --data-binary '@{{ fixture }}'

# Build the Worker into .cloudflare/output.
build:
    {{ pnpm }} run build

# Run the core and worker Vitest projects, passing extra arguments to Vitest.
test *args:
    {{ pnpm }} run test "$@"

# Start `cf dev` and a stub decision model, then drive the real Worker over HTTP.
e2e:
    {{ pnpm }} exec vitest run --config vitest.e2e.config.ts

# Mutate src/core and check that the core tests notice; the release gate reads the thresholds in stryker.config.mjs.
mutation:
    {{ pnpm }} exec stryker run

# Check the Lean models and theorems of the core, then regenerate the conformance vectors that the core tests replay.
proofs:
    cd proofs && lake build && lake exe vectors vectors

# The same proof check inside the bounded container that the owner's machines require for Lean, given the local image digest.
proofs-bounded image:
    dotfiles bounded run --image '{{ image }}' --project . -- lake -d proofs build
    dotfiles bounded run --image '{{ image }}' --project . -- lake -d proofs exe vectors proofs/vectors

# The release gate: the fast gate, the proofs, the end-to-end run, and the mutation campaign.
release-gate: check proofs e2e mutation

# Print the copy and service facts the Figma design uses, so the design is built from the same catalog as the Worker.
design-copy:
    mise x -- node tools/design-copy.ts

# Run the Worker with the stub decision model and the stub Access team, and print where to look at the pages, including the operator's.
preview:
    mise x -- node tools/preview.ts

# Generate the binding types, then check TypeScript.
typecheck:
    {{ pnpm }} run typecheck

# Lint and verify formatting with Biome.
lint:
    {{ pnpm }} run lint

# Apply Biome formatting and safe lint fixes.
fix:
    {{ pnpm }} run fix

# Regenerate .cloudflare/types/index.d.ts after editing cloudflare.config.ts.
types:
    {{ pnpm }} run types

# Run the full local gate: Biome also refuses an import from src/core to anything outside it and any import cycle.
check: lint typecheck test

# Apply the D1 migrations to the production database, whose id `cf d1 list` shows after the first deploy.
migrate-remote database:
    {{ pnpm }} exec cf d1 migrations apply '{{ database }}'

# Build and publish the Worker to Cloudflare, reading the secrets of the given Doppler config through a mount that is read once.
deploy config="prd":
    mkdir -p .cloudflare && {{ doppler }} run --config '{{ config }}' --no-fallback --mount '{{ secrets_mount }}' --mount-max-reads 1 -- {{ pnpm }} exec cf deploy --secrets-file '{{ secrets_mount }}'
