import { selectRecipient } from "../core/recipient-selection.ts";
import { deliveryMail } from "../core/reply-text.ts";
import type { Instant, UserId } from "../core/types.ts";
import { type Config, publicLink, readConfig } from "./env.ts";
import { type Ports, productionPorts } from "./ports.ts";
import {
	candidatesFor,
	completeDelivery,
	dueLetters,
	findUserById,
	type Letter,
	pageKeyOf,
	reserveDelivery,
	suppressUser,
	undoDelivery,
} from "./repository.ts";

export const DUE_LETTERS_PER_RUN = 50;

export type DeliveryRun = {
	readonly due: number;
	readonly delivered: number;
	readonly waiting: number;
	readonly failed: number;
};

/** Delivers every letter whose journey has ended to a random eligible stranger, and leaves the rest traveling. */
export async function runDelivery(
	env: Env,
	ports: Ports = productionPorts(env, readConfig(env)),
): Promise<DeliveryRun> {
	const config = readConfig(env);
	const now = ports.now();
	const due = await dueLetters(env.DB, now, DUE_LETTERS_PER_RUN);
	let delivered = 0;
	let waiting = 0;
	let failed = 0;
	for (const letter of due) {
		switch (await deliverOne(env.DB, config, ports, letter, now)) {
			case "delivered":
				delivered += 1;
				break;
			case "waiting":
				waiting += 1;
				break;
			case "failed":
				failed += 1;
				break;
		}
	}
	return { due: due.length, delivered, waiting, failed };
}

async function deliverOne(
	db: D1Database,
	config: Config,
	ports: Ports,
	letter: Letter,
	now: Instant,
): Promise<"delivered" | "waiting" | "failed"> {
	const recipient = selectRecipient(
		await candidatesFor(db, letter.senderId),
		letter.senderId,
		ports.uniform(),
	);
	if (recipient === null) {
		return "waiting";
	}
	const reportToken = ports.token();
	const reserved = await reserveDelivery(db, {
		letterId: letter.id,
		recipientId: recipient.id,
		reportToken,
		now,
	});
	if (!reserved) {
		return "waiting";
	}
	try {
		return await sendReserved(db, config, ports, letter, recipient.id, now, {
			reportToken,
		});
	} catch (error) {
		// Whatever broke after the reservation, the letter goes back on its way and the reader keeps the credit; the run itself goes on.
		console.warn(
			"delivery failed",
			error instanceof Error ? error.name : "unknown",
		);
		await undoDelivery(db, letter.id, recipient.id, now);
		return "failed";
	}
}

/** Sends the reserved letter to its reader and settles the reservation by the provider's answer. */
async function sendReserved(
	db: D1Database,
	config: Config,
	ports: Ports,
	letter: Letter,
	recipientId: UserId,
	now: Instant,
	{ reportToken }: { readonly reportToken: string },
): Promise<"delivered" | "failed"> {
	const user = await findUserById(db, recipientId);
	if (user === null) {
		await undoDelivery(db, letter.id, recipientId, now);
		return "failed";
	}
	const pageKey = await pageKeyOf(db, user.id);
	const outcome = await ports.send({
		to: user.email,
		mail: deliveryMail(user.locale, config.SERVICE_NAME, letter.body, {
			you: publicLink(config, "you", pageKey),
			report: publicLink(config, "report", reportToken),
		}),
		headers: {
			"Auto-Submitted": "auto-generated",
			"List-Unsubscribe": `<${publicLink(config, "stop", pageKey)}>`,
			"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
		},
	});
	switch (outcome.kind) {
		case "sent":
			await completeDelivery(db, letter.id, user.id, outcome.messageId, now);
			return "delivered";
		case "suppressed":
			// The provider refuses this address after a bounce or a complaint, so the letter goes back on its way and the reader stops receiving.
			await undoDelivery(db, letter.id, user.id, now);
			await suppressUser(db, user.id, now);
			return "failed";
		case "failed":
			console.warn("delivery failed", outcome.reason);
			await undoDelivery(db, letter.id, user.id, now);
			return "failed";
	}
}
