import type { EmailAddress } from "./types.ts";

const MAX_ADDRESS_LENGTH = 254;
const MAX_LOCAL_LENGTH = 64;
const MAX_LABEL_LENGTH = 63;
/** A deliverable domain has at least a name and a top-level label. */
const MIN_DOMAIN_LABELS = 2;
/** Dot-atom text: one or more atoms of printable ASCII without specials, joined by single dots. */
const LOCAL_PART =
	/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * Lowercases and trims an address, and admits only `local@label.label` shapes with a dotted ASCII domain.
 * Quoted local parts and internationalized domains stay out, because the service never writes to such an address.
 */
export function normalizeEmailAddress(raw: string): EmailAddress | null {
	const address = raw.trim().toLowerCase();
	if (address.length > MAX_ADDRESS_LENGTH) {
		return null;
	}
	const at = address.indexOf("@");
	if (at === -1) {
		return null;
	}
	const local = address.slice(0, at);
	const domain = address.slice(at + 1);
	if (local.length > MAX_LOCAL_LENGTH || !LOCAL_PART.test(local)) {
		return null;
	}
	const labels = domain.split(".");
	if (
		labels.length < MIN_DOMAIN_LABELS ||
		!labels.every(
			(label) => label.length <= MAX_LABEL_LENGTH && DOMAIN_LABEL.test(label),
		)
	) {
		return null;
	}
	return address as EmailAddress;
}
