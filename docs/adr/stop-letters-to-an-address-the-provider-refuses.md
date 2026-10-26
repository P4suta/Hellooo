---
date: 2026-10-26
status: Accepted
---

# Stop letters to an address the provider refuses

## Status

Accepted.

## Context

Cloudflare Email Sending keeps a suppression list of its own: a hard bounce or a spam complaint adds the recipient, and from then on `send()` on the Workers binding throws an error whose `code` is `E_RECIPIENT_SUPPRESSED`.
The service treated every failed send alike: it returned the letter to its journey and the credit to the reader, and the next run could draw the same reader again, so a bounced address could fail the same letter run after run.
The schema already had a `suppressed` user status that nothing set.
Email Sending also publishes bounce and complaint events to a Queue, which would make the mirror exact but adds a queue, a consumer, and a second deployment surface to a service that otherwise has one Worker.

## Decision

- The mail port answers with an outcome instead of throwing: the provider took the mail, refuses the address as suppressed, or failed for a reason named by the error's code or name alone.
- A suppressed outcome marks the person `suppressed`, once, with an event; a suppressed person is no longer a candidate, writes no more letters, and sees on the page about their address that no letter reaches it.
- On a delivery, the letter goes back on its way with the reader's credit before the reader is suppressed, so the next run draws another reader and the credit law holds.
- On a confirmation or a refusal mail, the person is suppressed and the letter stays as it was; a failed confirmation is recorded as `send_failed` with the kind of mail, never the address.
- Any other failure keeps today's behavior: the delivery is undone and retried on a later run, and the log carries the code, not the message.
- The service does not consume Email Sending's event subscriptions; the suppression list stays the provider's, and the service mirrors it at the moment a send is refused.

## Consequences

- An address that bounced stops costing a failed send per run, and its letters stop at the first refusal.
- A suppression that the provider later lets expire is not undone here; the address stays stopped, as an unsubscribed one does, until the operator decides otherwise.
- The mirror is as fresh as the next mail to that address, never earlier; between the bounce and that mail the service still believes the address receives.
- The `send_failed` events let the operator count failures by kind without reading mail.

## Alternatives rejected

- Consuming bounce and complaint events through a Queue would mirror the list at once but adds a queue and a consumer to a one-Worker service; it stays open for later.
- Retrying a suppressed address would waste a send per run and risk the account's sending reputation.
- Counting failures per address and suppressing after several would stop addresses during a provider outage.
