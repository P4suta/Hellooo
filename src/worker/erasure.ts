import { BODY_RETENTION_MS } from "../core/erasure.ts";
import { addMillis } from "../core/types.ts";
import { readConfig } from "./env.ts";
import { type Ports, productionPorts } from "./ports.ts";
import { eraseLetters } from "./repository.ts";

export type ErasureRun = {
	readonly erased: number;
};

/** Erases the text of the letters that settled a retention period ago, so a letter stays only as long as a report on it can need it. */
export async function runErasure(
	env: Env,
	ports: Ports = productionPorts(env, readConfig(env)),
): Promise<ErasureRun> {
	const now = ports.now();
	const erased = await eraseLetters(env.DB, {
		settledBefore: addMillis(now, -BODY_RETENTION_MS),
		now,
	});
	return { erased };
}
