# `hellooo`

Send one letter a week to a single address, and a stranger who also wrote one receives it after a journey of random length.

## Installation

```sh
mise install
mise x -- pnpm install
```

## Usage

```sh
mise x -- doppler login
mise x -- doppler setup
mise x -- just dev
# Doppler holds every secret; `doppler setup` reads doppler.yaml and selects the hellooo project.
# Mail the letters address once to register, follow the link, and the letter begins its journey.
# Mail to the public letters address reaches the deployed service; `just intake-sample` posts a fixture letter to the local Worker's email endpoint instead.
# docs/adr/email-only-participation-with-dmarc-gated-identity.md records the identity model, and docs/adr/moderate-letters-with-a-decision-model.md the moderation model.
# `just --list` shows the check, types, migration, and deploy recipes.
```

## License

Licensed under the [Apache License, Version 2.0](LICENSE-APACHE) or the [Massachusetts Institute of Technology (MIT) license](LICENSE-MIT), at your option.

Contributions use both licenses unless you state other terms.
