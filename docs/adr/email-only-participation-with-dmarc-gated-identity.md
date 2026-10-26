---
date: 2026-10-25
status: Accepted
---

# Email-only participation with DMARC-gated sender identity

## Status

Accepted.

## Context

Hellooo lets a person send one letter a week by emailing one service address, and only people who sent a letter receive one.
The service has no account page, so the incoming email is the only proof of who wrote.
The `From` header of an email is sender-supplied, and only Domain-based Message Authentication, Reporting, and Conformance (DMARC) alignment attests to it.
Cloudflare Email Routing receives the mail, and its Email Workers API answers a message with `reply()` only when the incoming mail has a valid DMARC result.
Outbound letters leave through Cloudflare Email Sending, which costs quota per message and reaches any address.
An unsolicited automatic reply to a forged sender would turn the service into a backscatter source.

## Decision

- Participation happens by email alone: the first authenticated mail from an unknown address stores the letter pending verification and replies with a verification link.
- The receiving server's `Authentication-Results` header decides authentication, and only its first value counts, because the last hop prepends it and lower copies may come from the sender.
- Mail that passes DMARC is handled at once, and a registered sender whose mail fails DMARC gets a confirmation link at the registered address instead of acceptance.
- Mail from an unknown or pending sender that fails DMARC gets no reply and no stored letter.
- The envelope sender identifies the writer only when the `From` header names the same address, because DMARC vouches for the header while `reply()` answers the envelope.
- Mail from the service's own addresses, mail marked `Auto-Submitted` with any value but `no`, mail with list headers, and mail with bulk, list, or junk precedence is ignored without a reply, and delivered letters carry `Auto-Submitted: auto-generated`, so no automatic exchange can start.
- Automatic replies to the sender use `reply()` only, so the service never sends an unsolicited mail to an unauthenticated address.
- The decision over one incoming mail is a pure function in `src/core/intake-decision.ts`, and the adapters in `src/worker` gather facts and apply it.
- One accepted letter grants its sender one receive credit, and a delivery spends one credit of the recipient, so the total of credits equals accepted minus delivered letters.

## Consequences

- Senders at providers with DMARC alignment, which covers the major consumer mailboxes, send with no extra step.
- Senders without DMARC alignment confirm each letter with one link, and a forged mail can at most trigger a confirmation that the real owner ignores.
- The service depends on Cloudflare adding `Authentication-Results`, and the header's presence and format are verified against real mail before launch.
- A sender who never writes receives nothing, which keeps the pool to people who took part.
- The pure core carries the property tests for the credit law, the weekly cap, recipient eligibility, and the journey bounds, and the adapters carry integration tests against D1.

## Alternatives rejected

- A unique address per sender, such as `hellooo+token@`, proves identity without DMARC but gives up the single public address the service is built around.
- A confirmation link for every letter removes spoofing entirely but adds a step to every send, so it stays the fallback for senders without DMARC.
- A web form instead of email would make identity trivial and lose the reason the service exists.
