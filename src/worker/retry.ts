import { rejectedContentMail } from "../core/reply-text.ts";
import { admitLetter } from "./admission.ts";
import { readConfig } from "./env.ts";
import { type Ports, productionPorts } from "./ports.ts";
import { findUserById, heldLetters } from "./repository.ts";
import { noteRefusedMail } from "./sending.ts";

export const HELD_LETTERS_PER_RUN = 50;

export type RetryRun = {
	readonly held: number;
	readonly accepted: number;
	readonly rejected: number;
	readonly waiting: number;
};

/**
 * Asks the model again about the letters it could not be asked about before.
 * The writer already heard that the letter was taken, so only a refusal sends a mail.
 */
export async function retryModeration(
	env: Env,
	ports: Ports = productionPorts(env, readConfig(env)),
): Promise<RetryRun> {
	const config = readConfig(env);
	const now = ports.now();
	const held = await heldLetters(env.DB, HELD_LETTERS_PER_RUN);
	let accepted = 0;
	let rejected = 0;
	let waiting = 0;
	for (const letter of held) {
		switch ((await admitLetter(env.DB, ports, letter, now)).kind) {
			case "accept":
				accepted += 1;
				break;
			case "reject-content": {
				rejected += 1;
				const writer = await findUserById(env.DB, letter.senderId);
				if (writer !== null) {
					const outcome = await ports.send({
						to: writer.email,
						mail: rejectedContentMail(writer.locale, config.SERVICE_NAME),
					});
					if (outcome.kind !== "sent") {
						await noteRefusedMail(env.DB, writer.id, outcome, "rejection", now);
					}
				}
				break;
			}
			case "retry-later":
				waiting += 1;
				break;
		}
	}
	return { held: held.length, accepted, rejected, waiting };
}
