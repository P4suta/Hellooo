import { admitLetter } from "./admission.ts";
import { publicLink, readConfig } from "./env.ts";
import { outcomeMail } from "./intake.ts";
import { type Ports, productionPorts } from "./ports.ts";
import { findUserById, heldLetters, pageKeyOf } from "./repository.ts";
import { noteRefusedMail } from "./sending.ts";

export const HELD_LETTERS_PER_RUN = 50;

export type RetryRun = {
	readonly held: number;
	readonly accepted: number;
	readonly rejected: number;
	readonly overCap: number;
	readonly waiting: number;
};

/**
 * Asks the model again about the letters it could not be asked about before.
 * The writer already heard that the letter was taken, so only a refusal or a lost week sends a mail.
 */
export async function retryModeration(
	env: Env,
	ports: Ports = productionPorts(env, readConfig(env)),
): Promise<RetryRun> {
	const config = readConfig(env);
	const now = ports.now();
	const held = await heldLetters(env.DB, HELD_LETTERS_PER_RUN);
	const run = {
		held: held.length,
		accepted: 0,
		rejected: 0,
		overCap: 0,
		waiting: 0,
	};
	for (const [index, letter] of held.entries()) {
		const outcome = await admitLetter(env.DB, ports, letter, now);
		if (outcome.kind === "retry-later") {
			// The model gave no answer, and the rest of the batch would wait out the same silence; they stay held for the next run.
			run.waiting += held.length - index;
			break;
		}
		switch (outcome.kind) {
			case "accept":
				run.accepted += 1;
				break;
			case "reject-content":
			case "over-cap": {
				if (outcome.kind === "over-cap") {
					run.overCap += 1;
				} else {
					run.rejected += 1;
				}
				const writer = await findUserById(env.DB, letter.senderId);
				if (writer !== null) {
					const sent = await ports.send({
						to: writer.email,
						mail: outcomeMail(
							writer.locale,
							config.SERVICE_NAME,
							outcome,
							publicLink(config, "you", await pageKeyOf(env.DB, writer.id)),
						),
					});
					if (sent.kind !== "sent") {
						await noteRefusedMail(env.DB, writer.id, sent, "rejection", now);
					}
				}
				break;
			}
		}
	}
	return run;
}
