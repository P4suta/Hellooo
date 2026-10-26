import { type ChildProcess, spawn } from "node:child_process";
import type { webcrypto } from "node:crypto";
import { rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { sign } from "hono/jwt";
import { MODERATION_QUESTIONS } from "../../src/core/moderation-verdict.ts";

export const DEV_PORT = 5199;
export const DEV_ORIGIN = "http://127.0.0.1:5199";
const LOOPBACK_HOST = "127.0.0.1";
export const LOCAL_DATABASE_ID = "00000000-0000-4000-8000-000000000001";
/** Letters that contain this word are judged as advertising by the stub decision model. */
export const SELLING_MARKER = "SELLSELL";
const STUB_PORT = 5198;
/** The stub stands in for Jev and for the Access team that signs operator tokens; cloudflare.config.ts points the e2e mode here. */
export const STUB_ORIGIN = `http://${LOOPBACK_HOST}:${STUB_PORT}`;
/** The audience tag that cloudflare.config.ts gives the e2e mode. */
const ACCESS_AUD = "hellooo-operator-e2e";
export const OPERATOR_EMAIL = "operator@example.com";
const ACCESS_KID = "e2e";
const TOKEN_LIFETIME_S = 3600;
/** JSON Web Token times are seconds since the epoch. */
const MS_PER_S = 1000;
const RSA_BITS = 2048;
const RSA_EXPONENT = new Uint8Array([1, 0, 1]);
const STATE_DIR = ".cloudflare/e2e-state";
const READY_PATH = "/cdn-cgi/local/explorer/api/local/workers";
const POLL_MS = 500;
const START_TIMEOUT_MS = 180_000;
const SELLING_PROBABILITY = 0.95;
const QUIET_PROBABILITY = 0.05;
const HTTP_OK = 200;
const HTTP_SEE_OTHER = 303;
const HTTP_NOT_FOUND = 404;
const HTTP_UNAVAILABLE = 503;

type JevRequest = { state?: unknown; questions?: Record<string, unknown> };
type JsonWebKey = webcrypto.JsonWebKey;
type Jwk = JsonWebKey & { kid: string; alg: string };

async function exportJwk(key: CryptoKey): Promise<JsonWebKey> {
	const exported = await crypto.subtle.exportKey("jwk", key);
	if (exported instanceof ArrayBuffer) {
		throw new Error("expected a JSON Web Key");
	}
	return exported;
}

/** A fresh RSA key pair that the stub publishes as the team's keys and signs operator tokens with. */
async function accessKeys(): Promise<{ signing: Jwk; published: Jwk }> {
	const generated = await crypto.subtle.generateKey(
		{
			name: "RSASSA-PKCS1-v1_5",
			modulusLength: RSA_BITS,
			publicExponent: RSA_EXPONENT,
			hash: "SHA-256",
		},
		true,
		["sign", "verify"],
	);
	if (!("privateKey" in generated)) {
		throw new Error("expected a key pair");
	}
	return {
		signing: {
			...(await exportJwk(generated.privateKey)),
			kid: ACCESS_KID,
			alg: "RS256",
		},
		published: {
			...(await exportJwk(generated.publicKey)),
			kid: ACCESS_KID,
			alg: "RS256",
		},
	};
}

function operatorToken(signing: Jwk): Promise<string> {
	const now = Math.floor(Date.now() / MS_PER_S);
	return sign(
		{
			iss: STUB_ORIGIN,
			aud: [ACCESS_AUD],
			email: OPERATOR_EMAIL,
			iat: now,
			exp: now + TOKEN_LIFETIME_S,
		},
		signing,
	);
}

function readBody(request: NodeJS.ReadableStream): Promise<string> {
	return new Promise((resolve) => {
		let body = "";
		request.on("data", (chunk: Buffer) => {
			body += chunk.toString("utf8");
		});
		request.on("end", () => resolve(body));
	});
}

/** The decision model's answer: every question is unlikely unless the letter carries the selling marker. */
function jevAnswer(body: string): string {
	const parsed = JSON.parse(body) as JevRequest;
	const state = typeof parsed.state === "string" ? parsed.state : "";
	const probability = (id: string): number =>
		id === "sells" && state.includes(SELLING_MARKER)
			? SELLING_PROBABILITY
			: QUIET_PROBABILITY;
	const answers = Object.fromEntries(
		Object.keys(parsed.questions ?? MODERATION_QUESTIONS).map((id) => [
			id,
			{ type: "noul", noul: probability(id) },
		]),
	);
	return JSON.stringify({
		model: "jev-latest",
		answers,
		usage: { input_tokens: 1, output_tokens: 1 },
	});
}

/**
 * The stub behind `cf dev --mode e2e`: Jev at `/systemone`, the Access team's keys at `/cdn-cgi/access/certs`,
 * a signed operator token at `/e2e/access-token`, and a browser sign-in at `/e2e/sign-in` that sets the Access cookie and opens the operator's page.
 * `POST /e2e/model-down` and `POST /e2e/model-up` make the model answer with a server error or normally.
 */
export function startStub(): Promise<Server> {
	const keys = accessKeys();
	let modelDown = false;
	const server = createServer(async (request, response) => {
		const json = { "content-type": "application/json" };
		if (request.method === "POST" && request.url === "/systemone") {
			const body = await readBody(request);
			if (modelDown) {
				response.writeHead(HTTP_UNAVAILABLE).end();
				return;
			}
			response.writeHead(HTTP_OK, json).end(jevAnswer(body));
			return;
		}
		if (request.method === "POST" && request.url === "/e2e/model-down") {
			modelDown = true;
			response.writeHead(HTTP_OK).end();
			return;
		}
		if (request.method === "POST" && request.url === "/e2e/model-up") {
			modelDown = false;
			response.writeHead(HTTP_OK).end();
			return;
		}
		if (request.method === "GET" && request.url === "/cdn-cgi/access/certs") {
			response
				.writeHead(HTTP_OK, json)
				.end(JSON.stringify({ keys: [(await keys).published] }));
			return;
		}
		if (request.method === "POST" && request.url === "/e2e/access-token") {
			response
				.writeHead(HTTP_OK, { "content-type": "text/plain" })
				.end(await operatorToken((await keys).signing));
			return;
		}
		if (request.method === "GET" && request.url === "/e2e/sign-in") {
			response
				.writeHead(HTTP_SEE_OTHER, {
					"set-cookie": `CF_Authorization=${await operatorToken((await keys).signing)}; Path=/; HttpOnly`,
					location: `${DEV_ORIGIN}/admin`,
				})
				.end();
			return;
		}
		response.writeHead(HTTP_NOT_FOUND).end();
	});
	return new Promise((resolve) => {
		server.listen(STUB_PORT, LOOPBACK_HOST, () => resolve(server));
	});
}

function run(args: readonly string[], env: NodeJS.ProcessEnv): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn("pnpm", [...args], { env, stdio: "inherit" });
		child.on("exit", (code) =>
			code === 0
				? resolve()
				: reject(new Error(`${args.join(" ")} exited with ${code}`)),
		);
		child.on("error", reject);
	});
}

async function waitUntilReady(): Promise<void> {
	const deadline = Date.now() + START_TIMEOUT_MS;
	let lastFailure = "no response yet";
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`${DEV_ORIGIN}${READY_PATH}`);
			if (response.ok) {
				return;
			}
			lastFailure = `status ${response.status}`;
		} catch (error) {
			lastFailure = error instanceof Error ? error.message : String(error);
		}
		await new Promise((resolve) => setTimeout(resolve, POLL_MS));
	}
	throw new Error(`cf dev did not become ready in time: ${lastFailure}`);
}

/** Starts the stub and `cf dev --mode e2e` on their own ports and state directory, and returns the function that stops both. */
export default async function setup(): Promise<() => Promise<void>> {
	// Every run starts from an empty database, so a letter accepted in an earlier run never takes a writer's weekly slot.
	await rm(STATE_DIR, { recursive: true, force: true });
	const stub = await startStub();
	const env: NodeJS.ProcessEnv = {
		...process.env,
		HELLOOO_DEV_PORT: String(DEV_PORT),
		HELLOOO_STATE_DIR: STATE_DIR,
		TYPESAFE_API_KEY: "e2e-stub-key",
	};
	await run(
		[
			"exec",
			"cf",
			"d1",
			"migrations",
			"apply",
			LOCAL_DATABASE_ID,
			"--local",
			"--persist-to",
			STATE_DIR,
		],
		env,
	);
	const dev: ChildProcess = spawn(
		"pnpm",
		["exec", "cf", "dev", "--mode", "e2e"],
		{
			env,
			stdio: "ignore",
			detached: true,
		},
	);
	try {
		await waitUntilReady();
	} catch (error) {
		stop(dev);
		stub.close();
		throw error;
	}
	return async () => {
		stop(dev);
		await new Promise<void>((resolve) => stub.close(() => resolve()));
	};
}

function stop(dev: ChildProcess): void {
	if (dev.pid !== undefined) {
		process.kill(-dev.pid, "SIGTERM");
	}
}
