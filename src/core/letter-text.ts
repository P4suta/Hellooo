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
const BLANK_RUN = /\n{3,}/g;
const BLANK = new Set([" ", "\t"]);
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

/** Drops the blanks at the end of every line in one pass; a regular expression anchored at the line end would rescan a long run of blanks for each one. */
export function withoutTrailingBlanks(text: string): string {
	return text
		.split("\n")
		.map((line) => {
			// `charAt(-1)` is the empty string, which is no blank, so the loop stops at the line's start on its own.
			let end = line.length;
			while (BLANK.has(line.charAt(end - 1))) {
				end -= 1;
			}
			return line.slice(0, end);
		})
		.join("\n");
}

/** Normalizes a plain-text body, bounds it by code points, and refuses contact details that would leak identities. */
export function prepareLetterText(raw: string): LetterText {
	const text = [
		...withoutTrailingBlanks(raw.replace(LINE_BREAK, "\n"))
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
