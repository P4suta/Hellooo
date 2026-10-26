---
date: 2026-10-26
status: Accepted
---

# Typeset pages and mails as one quiet column

## Status

Accepted.

## Context

The service shows a reader five web pages and nine mails, all of them text: a title, a few sentences, and at most one link.
The owner asked for a design made in Figma before any further implementation, as simple and clean as it can be, with nothing added for decoration.
The Figma file `Hellooo` at https://www.figma.com/design/clQ0tzduhjnqDiKYwZ825g holds the design; this record names the decisions behind it so that the stylesheet and the mail text can follow them.

## Decision

- Every page is one column of text, 560 pixels wide at most, centered on the viewport, with 24 pixels of side padding and 96 pixels above on desktop or 48 on a phone.
- The front page is three screens, each the height of the viewport: `Hellooo?` and `Anybody there?`, then the one sentence that says what to do with the address as a link inside it, then that a letter can be sent once a week and that writing one means one may arrive too; a down chevron at the foot of each screen moves to the next, and scroll snapping keeps one screen in view.
- The front page explains nothing else: the rules about links, addresses, and phone numbers reach a writer only in the mail that refuses such a letter, and the page about an address carries the stop and the language.
- The copy says what a reader can see or do and nothing about how the service works inside: no signatures, no review, no access control, and no sentence that a reader could infer from the page itself; the control that switches the language says what it does, in the reader's current language.
- Motion is the only ornament: the greeting appears line by line, each later screen's lines rise into view as the screen arrives, the chevron beckons, and every movement stops under `prefers-reduced-motion`.
- Hierarchy comes from size and space alone: three text styles, `Title` at 28 over 36, `Body` at 17 over 28, and `Small` at 14 over 22, all in the regular weight, separated by 24 pixels.
- The typeface follows the reader's language through one variable, `font/family`: Inter for English and Noto Sans JP for Japanese, so a page or mail switches script by switching the `Locale` mode; the stylesheet names the same families with the system font as fallback and loads nothing from the network.
- Color is two variables with light and dark modes, `color/bg` and `color/fg`, with CSS names `var(--color-bg)` and `var(--color-fg)`; quieter lines such as the footer and the envelope lines use the text color at 56 percent opacity, so nothing in the design is a third color.
- A link is underlined text in the text color; there are no buttons, icons other than the chevron, images, borders, or shadows, and the address `anybody@hellooo.email` on the front page is the only element that stands out, as a link.
- The copy is plain and concrete: a letter is "on its way" or "can't go out", never a journey or a pigeon, and nothing on the pages or in the mails tells the reader what to do in the imperative.
- Mails stay plain text and their previews use the same styles: envelope lines in `Small` at 56 percent, the body in `Body`, a `— — —` rule between a delivered letter and the footer, and the stop and report links as full addresses.
- The operator line and the contact address `post@hellooo.email` appear once, at the foot of the front page; the other pages carry only their title and lines, and every page state exists at 1280 and 390 pixels in English and Japanese, with the front page also shown in dark mode.
- A link into the service names a page and a key, such as `/you/<key>`, so no URL in a mail shows a token or a language parameter.

## Consequences

- The stylesheet in `src/worker/web.ts` carries the same tokens as custom properties, switches to dark by the reader's preference, and renders the front page as the three snapping screens.
- Adding a language means one more value of `font/family` and one more catalog, not new layouts.
- Mail clients render plain text in their own type, so the previews describe the structure of the text, not its final appearance.
- Nothing in the design depends on an image or a brand asset, so the operator can launch without any.

## Alternatives rejected

- A serif face for letters would suit the subject but doubles the font work for Japanese and adds a second voice to a design that wants one.
- Cards, boxes, or a header bar would frame the text without saying anything the text does not already say.
- Buttons for the stop and report actions would need styles and states for links that mail clients render as text anyway.
