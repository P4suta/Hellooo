import type { DmarcResult } from "./types.ts";

const COMMENT = /\([^)]*\)/g;
const DMARC_METHOD = "dmarc=";
/** A clause whose method is `dmarc`, with its result token; anchored so `x-dmarc=` and `dmarcx=` never match. */
const DMARC_CLAUSE = /^dmarc=[a-z0-9]+/i;

/**
 * Reads the DMARC result from the first `Authentication-Results` value only.
 * The receiving server prepends its header, so later values may be the sender's own claims.
 */
export function dmarcResult(headerValues: readonly string[]): DmarcResult {
	const trusted = headerValues[0];
	if (trusted === undefined) {
		return "none";
	}
	for (const clause of trusted.replace(COMMENT, "").split(";")) {
		const match = DMARC_CLAUSE.exec(clause.trim());
		if (match !== null) {
			const result = match[0].slice(DMARC_METHOD.length).toLowerCase();
			return result === "pass" ? "pass" : "fail";
		}
	}
	return "none";
}
