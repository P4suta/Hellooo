import type { Instant } from "./types.ts";

export const SUPPORTED_LOCALES = ["en", "ja"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

const DEFAULT_WEIGHT = 1;
/** The `q` parameter of an `Accept-Language` entry, as `;q=0.8` or `; q = 0.8`; its value runs to the next `;`. */
const QUALITY = /;\s*q\s*=([^;]*)/i;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
/** Scripts that identify one supported locale on their own; Han alone stays undecided because it is shared. */
const SCRIPT_LOCALES: readonly (readonly [RegExp, Locale])[] = [[KANA, "ja"]];

/** The supported locale named by a BCP 47 tag's primary subtag, such as `ja` for `ja-JP`. */
export function localeFromLanguageTag(tag: string): Locale | null {
	const lower = tag.trim().toLowerCase();
	for (const locale of SUPPORTED_LOCALES) {
		if (lower === locale || lower.startsWith(`${locale}-`)) {
			return locale;
		}
	}
	return null;
}

/** The text before the first occurrence of `separator`, or the whole string without one. */
function before(text: string, separator: string): string {
	const at = text.indexOf(separator);
	return at === -1 ? text : text.slice(0, at);
}

type Preference = {
	readonly tag: string;
	readonly weight: number;
};

/** One `Accept-Language` entry; an unreadable weight becomes NaN, which no comparison accepts. */
function preference(entry: string): Preference {
	const quality = QUALITY.exec(entry);
	return {
		tag: before(entry, ";").trim(),
		weight: quality === null ? DEFAULT_WEIGHT : Number(quality[1]),
	};
}

/** Content negotiation over an `Accept-Language` header, falling back to the default locale. */
export function negotiateLocale(
	acceptLanguage: string | null | undefined,
): Locale {
	if (acceptLanguage === null || acceptLanguage === undefined) {
		return DEFAULT_LOCALE;
	}
	let best: Preference | null = null;
	for (const entry of acceptLanguage.split(",")) {
		const candidate = preference(entry);
		if (!(candidate.weight > 0)) {
			continue;
		}
		const locale =
			candidate.tag === "*"
				? DEFAULT_LOCALE
				: localeFromLanguageTag(candidate.tag);
		if (locale !== null && (best === null || candidate.weight > best.weight)) {
			best = { tag: locale, weight: candidate.weight };
		}
	}
	return best === null ? DEFAULT_LOCALE : (best.tag as Locale);
}

/** The locale a letter's script reveals, or null when the script is shared or Latin. */
export function detectLocaleFromText(text: string): Locale | null {
	for (const [script, locale] of SCRIPT_LOCALES) {
		if (script.test(text)) {
			return locale;
		}
	}
	return null;
}

/** The first language of a `Content-Language` header, when it names a supported locale. */
export function localeFromContentLanguage(
	header: string | null | undefined,
): Locale | null {
	if (header === null || header === undefined) {
		return null;
	}
	return localeFromLanguageTag(before(header, ","));
}

/** The name of a region in the reader's language, from its ISO 3166-1 alpha-2 code; the code itself when the runtime has no name for it. */
export function regionName(locale: Locale, code: string): string {
	return (
		new Intl.DisplayNames(locale, { type: "region", fallback: "code" }).of(
			code,
		) ?? code
	);
}

/** A calendar date in the reader's language, read in UTC so every reader sees the same day. */
export function formatDate(locale: Locale, at: Instant): string {
	return new Intl.DateTimeFormat(locale, {
		dateStyle: "long",
		timeZone: "UTC",
	}).format(at);
}
