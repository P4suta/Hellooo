import type { LetterTextProblem } from "./letter-text.ts";
import { formatDate, type Locale } from "./locale.ts";
import { messagesFor } from "./messages.ts";
import type { Instant } from "./types.ts";

export type Mail = {
	readonly subject: string;
	readonly text: string;
};

const RULE = "— — —";

function paragraphs(...lines: readonly string[]): string {
	return `${lines.join("\n\n")}\n`;
}

function subject(serviceName: string, text: string): string {
	return `${serviceName}: ${text}`;
}

export function verificationMail(
	locale: Locale,
	serviceName: string,
	link: string,
): Mail {
	const m = messagesFor(locale).mail.verification;
	return {
		subject: subject(serviceName, m.subject),
		text: paragraphs(m.intro, link),
	};
}

export function confirmationMail(
	locale: Locale,
	serviceName: string,
	link: string,
): Mail {
	const m = messagesFor(locale).mail.confirmation;
	return {
		subject: subject(serviceName, m.subject),
		text: paragraphs(m.intro, link),
	};
}

/** The reply to an accepted letter, ending with the link to the page about the writer's own address. */
export function acceptedMail(
	locale: Locale,
	serviceName: string,
	youLink: string,
): Mail {
	const m = messagesFor(locale).mail;
	return {
		subject: subject(serviceName, m.accepted.subject),
		text: paragraphs(m.accepted.begun, m.accepted.maybe, `${m.you} ${youLink}`),
	};
}

export function overCapMail(
	locale: Locale,
	serviceName: string,
	nextAllowedAt: Instant,
): Mail {
	const m = messagesFor(locale).mail.overCap;
	return {
		subject: subject(serviceName, m.subject),
		text: paragraphs(
			m.dropped,
			m.writeAgain(formatDate(locale, nextAllowedAt)),
		),
	};
}

export function rejectedTextMail(
	locale: Locale,
	serviceName: string,
	problem: LetterTextProblem,
): Mail {
	const m = messagesFor(locale).mail.cannotTravel;
	return {
		subject: subject(serviceName, m.subject),
		text: paragraphs(m.problems[problem], m.rewrite),
	};
}

export function rejectedContentMail(locale: Locale, serviceName: string): Mail {
	const m = messagesFor(locale).mail.cannotTravel;
	return {
		subject: subject(serviceName, m.subject),
		text: paragraphs(m.refused, m.another),
	};
}

export function rejectionsExhaustedMail(
	locale: Locale,
	serviceName: string,
): Mail {
	const m = messagesFor(locale).mail.exhausted;
	return {
		subject: subject(serviceName, m.subject),
		text: paragraphs(m.resting),
	};
}

export type DeliveryLinks = {
	/** The page about the reader's own address, where the language changes and letters stop. */
	readonly you: string;
	readonly report: string;
};

export function deliveryMail(
	locale: Locale,
	serviceName: string,
	body: string,
	links: DeliveryLinks,
): Mail {
	const m = messagesFor(locale).mail;
	return {
		subject: subject(serviceName, m.delivery.subject),
		text: paragraphs(
			body,
			RULE,
			m.delivery.footer(serviceName),
			`${m.you} ${links.you}`,
			`${m.delivery.report} ${links.report}`,
		),
	};
}
