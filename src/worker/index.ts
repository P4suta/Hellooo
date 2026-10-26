import { runDelivery } from "./delivery.ts";
import { type Config, readConfig } from "./env.ts";
import { runErasure } from "./erasure.ts";
import { handleIncomingEmail } from "./intake.ts";
import { type Ports, productionPorts } from "./ports.ts";
import { retryModeration } from "./retry.ts";
import { createApp } from "./web.ts";

export type PortsFor = (env: Env, config: Config) => Ports;

/** Each run asks the model again about waiting letters, delivers the letters whose journey has ended, then erases the text of letters settled long ago. */
export async function runScheduled(env: Env, ports: Ports): Promise<void> {
	await retryModeration(env, ports);
	await runDelivery(env, ports);
	await runErasure(env, ports);
}

/** The three handlers wired to one source of effects, so a test can replace the clock, randomness, moderator, and mail. */
export function createWorker(portsFor: PortsFor = productionPorts) {
	const app = createApp(portsFor);
	return {
		email: (message, env, _ctx) =>
			handleIncomingEmail(message, env, portsFor(env, readConfig(env))),
		scheduled: (_controller, env, ctx) => {
			ctx.waitUntil(runScheduled(env, portsFor(env, readConfig(env))));
		},
		fetch: app.fetch,
	} satisfies ExportedHandler<Env>;
}

export default createWorker();
