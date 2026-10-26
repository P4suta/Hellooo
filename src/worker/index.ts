import { SUPPORTED_LOCALES } from "../core/locale.ts";
import { messagesFor } from "../core/messages.ts";
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
	await runStages([
		["retry", () => retryModeration(env, ports)],
		["delivery", () => runDelivery(env, ports)],
		["erasure", () => runErasure(env, ports)],
	]);
}

/** Runs every stage even when an earlier one fails, logs each failure by its name alone, and fails the run afterwards so the platform records it. */
export async function runStages(
	stages: ReadonlyArray<readonly [string, () => Promise<unknown>]>,
): Promise<void> {
	const failed: string[] = [];
	for (const [name, stage] of stages) {
		try {
			await stage();
		} catch (error) {
			console.error(
				`${name} failed`,
				error instanceof Error ? error.name : "unknown",
			);
			failed.push(name);
		}
	}
	if (failed.length > 0) {
		throw new Error(`stages failed: ${failed.join(", ")}`);
	}
}

const HTTP_SERVICE_UNAVAILABLE = 503;

/** The one page a closed service answers with, in both languages, so nobody registers or reads while the service is off. */
function closedPage(): Response {
	const lines = SUPPORTED_LOCALES.map(
		(locale) =>
			`<p lang="${locale}">${messagesFor(locale).web.front.closed}</p>`,
	).join("");
	return new Response(
		`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Hellooo</title></head><body>${lines}</body></html>`,
		{
			status: HTTP_SERVICE_UNAVAILABLE,
			headers: {
				"Content-Type": "text/html; charset=utf-8",
				"Cache-Control": "no-store",
				"Retry-After": "86400",
			},
		},
	);
}

/** The three handlers wired to one source of effects, so a test can replace the clock, randomness, moderator, and mail; a closed service answers nothing but its notice. */
export function createWorker(portsFor: PortsFor = productionPorts) {
	const app = createApp(portsFor);
	return {
		email: async (message, env, _ctx) => {
			const config = readConfig(env);
			if (config.SERVICE_CLOSED) {
				return;
			}
			await handleIncomingEmail(message, env, portsFor(env, config));
		},
		scheduled: (_controller, env, ctx) => {
			const config = readConfig(env);
			if (config.SERVICE_CLOSED) {
				return;
			}
			ctx.waitUntil(runScheduled(env, portsFor(env, config)));
		},
		fetch: (request: Request, env: Env, ctx: ExecutionContext) =>
			readConfig(env).SERVICE_CLOSED
				? closedPage()
				: app.fetch(request, env, ctx),
	} satisfies ExportedHandler<Env>;
}

export default createWorker();
