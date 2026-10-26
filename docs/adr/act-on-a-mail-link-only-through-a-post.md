---
date: 2026-10-26
status: Accepted
---

# Act on a mail link only through a post

## Status

Accepted.
Extends [identify-readers-by-keyed-links-and-operators-by-cloudflare-access.md](identify-readers-by-keyed-links-and-operators-by-cloudflare-access.md), which already shows the stop page on a GET and stops on a POST.

## Context

The verification, confirmation, and report links in mails changed state when opened: a GET activated an address, sent a confirmed letter on its way, or recorded a report.
Mail scanners open links before a person does, so a scanner could confirm a letter the person had not written, and every opening of a report link recorded another report, which inflated the count and kept the letter from erasure.
The stop link already avoided this by showing a page first.

## Decision

- Opening a verification, confirmation, or report link shows a page that asks, in the language stored for the person, and changes nothing.
- The confirmation page shows the letter, so the person judges what they send.
- One button on that page posts to the same path, and the post performs the action under the same origin check as every other post.
- A used or unknown key answers the same pages as before, on the GET and on the POST.
- One delivery carries at most one report; a second post for the same report token changes nothing and thanks the reader again.

## Consequences

- A link opened by a scanner leaves the address pending, the letter unconfirmed, and the letter unreported.
- A person clicks once more than before, on a page that names what the click does.
- The one-click stop of `List-Unsubscribe` stays a post from the mail client, as it was.

## Alternatives rejected

- Keeping the GET actions and ignoring repeated reports would still let a scanner confirm a letter.
- A signed, single-use nonce in the link would not stop a scanner that opens the link first.
