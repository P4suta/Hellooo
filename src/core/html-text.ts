/** Markup beyond this many characters is never read, because a letter keeps far fewer and a hostile body may be megabytes. */
export const HTML_SCAN_LIMIT = 262_144;
/** Elements whose content is never visible, with the pattern that closes each. */
const HIDDEN_ELEMENT_CLOSERS: ReadonlyMap<string, RegExp> = new Map([
	["script", /<\/script\s*>/gi],
	["style", /<\/style\s*>/gi],
	["head", /<\/head\s*>/gi],
]);
const BREAKING_TAGS: ReadonlySet<string> = new Set([
	"br",
	"/p",
	"/div",
	"/li",
	"/h1",
	"/h2",
	"/h3",
	"/h4",
	"/h5",
	"/h6",
	"/tr",
]);
/** A map rather than an object, so a name such as `constructor` finds nothing inherited. */
const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
	["amp", "&"],
	["lt", "<"],
	["gt", ">"],
	["quot", '"'],
	["apos", "'"],
	["nbsp", " "],
]);
const ENTITY = /&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi;
/** Everything after a tag's name: from the first whitespace or slash that is not the leading slash of a closing tag. */
const AFTER_NAME = /(?!^)[\s/].*/s;
/** Browsers read `<` as markup only before a letter, a slash, `!`, or `?`; any other `<` is text. */
const TAG_START = /[a-z/!?]/i;
/** Inside a tag, a quoted attribute value may contain `>`, so quotes are skipped as whole tokens. */
const TAG_TOKEN = /"[^"]*"|'[^']*'|>/g;
const HEX_RADIX = 16;
const DECIMAL_RADIX = 10;
const MAX_CODE_POINT = 0x10ffff;

function decodeEntity(entity: string, body: string): string {
	const lower = body.toLowerCase();
	if (lower.startsWith("#x")) {
		return codePoint(
			Number.parseInt(lower.slice("#x".length), HEX_RADIX),
			entity,
		);
	}
	if (lower.startsWith("#")) {
		return codePoint(
			Number.parseInt(lower.slice("#".length), DECIMAL_RADIX),
			entity,
		);
	}
	return NAMED_ENTITIES.get(lower) ?? entity;
}

/** The digits came from the entity pattern, so the only invalid values lie past the last code point. */
function codePoint(value: number, entity: string): string {
	return value <= MAX_CODE_POINT ? String.fromCodePoint(value) : entity;
}

/** The lowercase name of a tag's text, such as `br`, `/p`, or `!--` for a comment. */
function tagName(tag: string): string {
	return tag.replace(AFTER_NAME, "").toLowerCase();
}

/** The index of the `>` that ends the tag opened at `open`, or -1 when the tag never closes. */
const COMMENT_OPEN = "<!--";
const COMMENT_CLOSE = "-->";

/** The index of the last character of a comment's `-->`, or -1 when the comment never closes; a `>` inside the comment ends nothing. */
function commentEnd(html: string, open: number): number {
	const close = html.indexOf(COMMENT_CLOSE, open + COMMENT_OPEN.length);
	return close === -1 ? -1 : close + COMMENT_CLOSE.length - 1;
}

function tagEnd(html: string, open: number): number {
	TAG_TOKEN.lastIndex = open + 1;
	for (
		let match = TAG_TOKEN.exec(html);
		match !== null;
		match = TAG_TOKEN.exec(html)
	) {
		if (match[0] === ">") {
			return match.index;
		}
	}
	return -1;
}

/** The index just past the closing tag of a hidden element, or the end of the input when it never closes. */
function closerEnd(html: string, from: number, closer: RegExp): number {
	closer.lastIndex = from;
	const match = closer.exec(html);
	return match === null ? html.length : match.index + match[0].length;
}

/** Drops tags, hidden elements, and attribute values in one linear pass; a `<` that never closes stays text. */
function stripTags(html: string): string {
	let out = "";
	let i = 0;
	for (;;) {
		const open = html.indexOf("<", i);
		if (open === -1) {
			return out + html.slice(i);
		}
		out += html.slice(i, open);
		if (!TAG_START.test(html.charAt(open + 1))) {
			out += "<";
			i = open + 1;
			continue;
		}
		const end = html.startsWith(COMMENT_OPEN, open)
			? commentEnd(html, open)
			: tagEnd(html, open);
		if (end === -1) {
			return out + html.slice(open);
		}
		const name = tagName(html.slice(open + 1, end));
		i = end + 1;
		const closer = HIDDEN_ELEMENT_CLOSERS.get(name);
		if (closer !== undefined) {
			i = closerEnd(html, i, closer);
		} else if (BREAKING_TAGS.has(name)) {
			out += "\n";
		}
	}
}

/** The visible text of an HTML-only mail body, for senders whose client sends no plain-text part. */
export function plainTextOfHtml(html: string): string {
	return stripTags(html.slice(0, HTML_SCAN_LIMIT)).replace(
		ENTITY,
		decodeEntity,
	);
}
