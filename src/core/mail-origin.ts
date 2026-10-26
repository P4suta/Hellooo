import type { EmailAddress } from "./types.ts";

/** One parsed header, with the key already lowercased by the mail parser. */
export type Header = {
	readonly key: string;
	readonly value: string;
};

export type OriginProblem =
	| "own-address"
	| "misaligned-from"
	| "auto-submitted"
	| "mailing-list"
	| "bulk";

export type Origin = {
	/** The envelope sender, which Cloudflare answers with `reply()`. */
	readonly envelopeFrom: EmailAddress;
	/** The `From` header, which DMARC alignment attests to; null when the header names no address. */
	readonly headerFrom: EmailAddress | null;
	readonly ownAddresses: readonly EmailAddress[];
	readonly headers: readonly Header[];
};

const AUTO_SUBMITTED = "auto-submitted";
const NOT_AUTOMATED = "no";
const PRECEDENCE = "precedence";
const LIST_HEADERS: ReadonlySet<string> = new Set([
	"list-id",
	"list-post",
	"list-unsubscribe",
]);
const BULK_PRECEDENCE: ReadonlySet<string> = new Set(["bulk", "junk", "list"]);

/**
 * Why a mail is not one person's letter, or null when it may be one.
 * A reply goes to the envelope sender while DMARC vouches for the `From` header, so both must name the same address.
 * Automatic mail is ignored so that the service never answers an auto-responder, a list, or itself.
 */
export function originProblem(origin: Origin): OriginProblem | null {
	if (origin.ownAddresses.includes(origin.envelopeFrom)) {
		return "own-address";
	}
	if (origin.headerFrom !== origin.envelopeFrom) {
		return "misaligned-from";
	}
	for (const { key, value } of origin.headers) {
		const token = value.trim().toLowerCase();
		if (key === AUTO_SUBMITTED && token !== NOT_AUTOMATED) {
			return "auto-submitted";
		}
		if (LIST_HEADERS.has(key)) {
			return "mailing-list";
		}
		if (key === PRECEDENCE && BULK_PRECEDENCE.has(token)) {
			return "bulk";
		}
	}
	return null;
}
