import type { Locale } from "../../src/core/locale.ts";
import { type Messages, messagesFor } from "../../src/core/messages.ts";

/** The subject of a service mail as `reply-text.ts` composes it: the service name, a colon, and the catalog line. */
export function mailSubject(
	serviceName: string,
	locale: Locale,
	pick: (mail: Messages["mail"]) => { readonly subject: string },
): string {
	return `${serviceName}: ${pick(messagesFor(locale).mail).subject}`;
}

/** The web catalog of a locale, so a test names the line it expects instead of repeating it. */
export function web(locale: Locale): Messages["web"] {
	return messagesFor(locale).web;
}

/** Text as Hono's `html` template escapes it, so a catalog line can be sought inside a rendered page. */
export function inHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
