export const LETTER_MAX_CHARS = 4000;

export type LetterTextProblem =
	| "empty"
	| "url"
	| "email-address"
	| "phone-number";

export type LetterText =
	| { readonly ok: true; readonly text: string }
	| { readonly ok: false; readonly problem: LetterTextProblem };

const LINE_BREAK = /\r\n?/g;
const TRAILING_BLANKS = /[ \t]+$/gm;
const BLANK_RUN = /\n{3,}/g;
/** The last letter of a scheme followed by `://`, or a `www.` host; each predicate tests presence, so it needs no repetition. */
const SCHEME_URL = /[a-z]:\/\//i;
const WWW_HOST = /\bwww\./i;
const EMAIL_ADDRESS = /[^\s@]@[^\s@.]+\.[^\s@]/;
const PHONE_NUMBER = /\+?\d(?:[\s().-]*\d){8,}/;

const PROBLEMS: readonly (readonly [RegExp, LetterTextProblem])[] = [
	[SCHEME_URL, "url"],
	[WWW_HOST, "url"],
	[EMAIL_ADDRESS, "email-address"],
	[PHONE_NUMBER, "phone-number"],
];

/** Normalizes a plain-text body, bounds it by code points, and refuses contact details that would leak identities. */
export function prepareLetterText(raw: string): LetterText {
	const text = [
		...raw
			.replace(LINE_BREAK, "\n")
			.replace(TRAILING_BLANKS, "")
			.replace(BLANK_RUN, "\n\n")
			.trim(),
	]
		.slice(0, LETTER_MAX_CHARS)
		.join("")
		.trim();
	if (text.length === 0) {
		return { ok: false, problem: "empty" };
	}
	for (const [pattern, problem] of PROBLEMS) {
		if (pattern.test(text)) {
			return { ok: false, problem };
		}
	}
	return { ok: true, text };
}
