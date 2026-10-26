import type { Instant, UserId } from "../core/types.ts";
import type { SendOutcome } from "./ports.ts";
import { recordEvent, suppressUser } from "./repository.ts";

export type RefusedMail = Exclude<SendOutcome, { kind: "sent" }>;

/** The mails a person receives about their own letters, as the event log names them. */
export type NoticeKind = "confirmation" | "rejection";

/**
 * What follows a mail the provider did not take.
 * A suppressed address stops receiving letters; any other failure is logged by its reason and recorded by the kind of mail, never by the address.
 */
export async function noteRefusedMail(
	db: D1Database,
	to: UserId,
	outcome: RefusedMail,
	what: NoticeKind,
	now: Instant,
): Promise<void> {
	if (outcome.kind === "suppressed") {
		await suppressUser(db, to, now);
		return;
	}
	console.warn(`${what} mail failed`, outcome.reason);
	await recordEvent(db, { kind: "send_failed", userId: to, detail: what, now });
}
