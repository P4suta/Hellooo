---
date: 2026-10-26
status: Accepted
---

# Identify readers by keyed links and operators by Cloudflare Access

## Status

Accepted.

## Context

A person takes part by mail alone, so the service has no login, yet two things need a page: a reader wants to see which address is registered, read the service in another language, and stop, and the operator must see the letters readers report.
Until now the links in mails carried `?token=` and `&lang=`, which read like machinery, and the operator had no page at all, so reports waited in a mailbox the owner would have to watch forever.
Accounts with passwords would add a second identity to protect beside the mail address, which Domain-based Message Authentication, Reporting, and Conformance (DMARC) already vouches for.

## Decision

- Every link into the service names a page and a key, and nothing else: `/verify/<key>`, `/confirm/<key>`, `/you/<key>`, `/stop/<key>`, and `/report/<key>`.
  The page reads in the language stored for the address or letter the key names, so no language travels in a URL.
- The pages live on `www.hellooo.email`, not on the bare domain, which a Cloudflare redirect rule sends to `www`; the mail addresses keep the bare domain.
- Each person holds one page key, carried in every mail the service sends them.
  It opens the page about their address, which shows the address, whether letters reach it, the language of their mail with the other language as a control, and the stop control.
  A pending address sees that it waits for its confirmation, and a stopped one sees that no letter reaches it and no controls.
- The same key is the one-click stop of `List-Unsubscribe`, posted by mail clients; opening the stop link in a browser shows the page instead of stopping, because mail scanners open links.
- The operator's pages live under `/admin`, behind a Cloudflare Access application whose team domain and audience tag the configuration names.
  The Worker verifies the token Access signs against the team's published keys, including issuer, audience, and validity, and answers 401 otherwise; while both settings are empty, the pages stay closed to everyone.
- The operator's page shows how many people receive, how many letters are on their way, and how many were delivered, then the reported letters with their text and counts.
  The two decisions are to close a report and to ban a writer, which loses their letters still waiting or on their way; no letter waits for a person before it goes out.
- Every post is refused unless its `Origin` and `Sec-Fetch-Site` headers are absent or name the page's own origin, so a form on another site cannot stop an address or act as the operator through the Access cookie.
- The decisions over what the page about an address shows are a pure function in `src/core/you-page.ts` with a Lean model and conformance vectors like the other core decisions; the sign-in check is an adapter with integration tests against keys generated in the test.

## Consequences

- A reader manages their address from any mail the service sent them, without a password, and a leaked mail exposes only that address's page.
- The operator needs no mailbox watch for reported letters, only for human questions to the contact address.
- The operator pages need the Access application before launch; `just preview` runs the Worker with a stub team that signs tokens, so the pages can be seen without one.
- A page key is as sensitive as a session: anyone holding it can change the language or stop the letters of that address, which is the same power the former unsubscribe token already had.

## Alternatives rejected

- Accounts with a password would need a second identity, password reset by mail, and a session store, and would add nothing to what the keyed page offers.
- A magic-link login would send a mail to reach a page that every mail already links to.
- Keeping `?token=` in links would keep working but reads as machinery, which the owner refused.
- Guarding `/admin` by a secret in the URL would leak through browser history and referrers; Access keeps the secret in the operator's identity.
