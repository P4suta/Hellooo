---
date: 2026-10-26
status: Accepted
---

# Localize replies by detected script and browser language

## Status

Accepted.

## Context

The service speaks to people in three places: automatic replies to the sender, delivered letters to the recipient, and the web pages behind the links in those mails.
A sender never fills in a form, so the service learns nothing about their language except what the mail itself carries.
Letters may be written in any language, and the owner wants readers served in theirs, starting with English and Japanese.

## Decision

- `src/core/locale.ts` names the supported locales, negotiates `Accept-Language`, reads `Content-Language`, and detects Japanese from kana in the letter text.
- Every text a reader sees lives in `src/core/messages.ts`, typed so that a locale compiles only when it fills every field.
- A sender's locale is fixed at registration from the first mail: `Content-Language` when present, otherwise the letter's script, otherwise English.
- The locale is stored on the user (`users.locale`) and governs every later reply and every letter delivered to that person.
- Links in mails carry `lang`, and the web pages prefer that parameter over the browser's `Accept-Language`, so a page always matches the mail that led to it.
- Dates are written with `Intl.DateTimeFormat` in the reader's language, in UTC.

## Consequences

- A Japanese writer gets Japanese replies without any setting, and an English writer never sees Japanese.
- A writer whose first letter is in English but who later writes in Japanese keeps English until a settings page exists.
- Han characters without kana stay undecided and fall back to English, because Chinese and Japanese share them.
- Adding a locale means adding one catalog entry and one line to `SUPPORTED_LOCALES`; the type checker lists every missing string.
- Moderation questions stay English prose for the model and are not localized.

## Alternatives rejected

- Asking the sender for a language would need a form, which the email-only design excludes.
- Detecting the language with a library or a model would add a dependency for a two-locale service; script detection covers the current need and is a pure function.
- Serving the browser's language alone would show a Japanese writer an English page when their browser is set to English, so the mail's `lang` parameter wins.
