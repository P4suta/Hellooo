import { env } from "cloudflare:workers";
import { sign } from "hono/jwt";
import type { JWTPayload } from "hono/utils/jwt/types";
import { beforeAll, describe, expect, it } from "vitest";
import { verifyOperator } from "../../src/worker/access.ts";
import { readConfig } from "../../src/worker/env.ts";
import type { Fetch } from "../../src/worker/moderation.ts";

const ISSUER = "https://team.example";
const AUD = "application-aud";
const KID = "key-1";
const HOUR_S = 3600;
/** JSON Web Token times are seconds since the epoch. */
const MS_PER_S = 1000;
const RSA_BITS = 2048;
const RSA_EXPONENT = new Uint8Array([1, 0, 1]);
const HTTP_OK = 200;
const HTTP_FOUND = 302;
const HTTP_UNAVAILABLE = 503;

type Jwk = JsonWebKey & { kid: string; alg: string };

let signingKey: Jwk;
let publishedKey: Jwk;
let otherSigningKey: Jwk;

const config = readConfig({ ...env, ACCESS_ISSUER: ISSUER, ACCESS_AUD: AUD });

async function exportJwk(key: CryptoKey): Promise<JsonWebKey> {
	const exported = await crypto.subtle.exportKey("jwk", key);
	if (exported instanceof ArrayBuffer) {
		throw new Error("expected a JSON Web Key");
	}
	return exported;
}

async function keyPair(kid: string): Promise<[Jwk, Jwk]> {
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
	return [
		{ ...(await exportJwk(generated.privateKey)), kid, alg: "RS256" },
		{ ...(await exportJwk(generated.publicKey)), kid, alg: "RS256" },
	];
}

function nowSeconds(): number {
	return Math.floor(Date.now() / MS_PER_S);
}

function claims(overrides: Partial<JWTPayload> = {}): JWTPayload {
	return {
		iss: ISSUER,
		aud: [AUD],
		email: "owner@example.com",
		iat: nowSeconds() - 1,
		exp: nowSeconds() + HOUR_S,
		...overrides,
	};
}

function serving(
	keys: readonly Jwk[],
	status = HTTP_OK,
): Fetch & { calls: string[]; inits: RequestInit[] } {
	const calls: string[] = [];
	const inits: RequestInit[] = [];
	const fetchImpl = async (
		url: string,
		init: RequestInit,
	): Promise<Response> => {
		calls.push(url);
		inits.push(init);
		return new Response(JSON.stringify({ keys }), {
			status,
			headers: { "content-type": "application/json" },
		});
	};
	return Object.assign(fetchImpl, { calls, inits });
}

beforeAll(async () => {
	[signingKey, publishedKey] = await keyPair(KID);
	[otherSigningKey] = await keyPair("key-2");
});

describe("the operator's sign-in through Cloudflare Access", () => {
	it("accepts a token signed by a published key for this issuer and audience", async () => {
		const token = await sign(claims(), signingKey);
		const fetchImpl = serving([publishedKey]);
		expect(await verifyOperator(token, config, fetchImpl)).toEqual({
			email: "owner@example.com",
		});
		expect(fetchImpl.calls).toEqual([`${ISSUER}/cdn-cgi/access/certs`]);
	});

	it("never follows a redirect of the key set and bounds the wait", async () => {
		const token = await sign(claims(), signingKey);
		const fetchImpl = serving([publishedKey]);
		await verifyOperator(token, config, fetchImpl);
		expect(fetchImpl.inits[0]?.redirect).toBe("manual");
		expect(fetchImpl.inits[0]?.signal).toBeInstanceOf(AbortSignal);
		expect(
			await verifyOperator(token, config, serving([publishedKey], HTTP_FOUND)),
		).toBeNull();
	});

	it("accepts an audience given as one string", async () => {
		const token = await sign(claims({ aud: AUD }), signingKey);
		expect(
			await verifyOperator(token, config, serving([publishedKey])),
		).toEqual({ email: "owner@example.com" });
	});

	it.each<[string, () => Promise<string>]>([
		["another audience", () => sign(claims({ aud: ["other"] }), signingKey)],
		[
			"another issuer",
			() => sign(claims({ iss: "https://other.example" }), signingKey),
		],
		[
			"an expired token",
			() => sign(claims({ exp: nowSeconds() - 1 }), signingKey),
		],
		[
			"a token from the future",
			() => sign(claims({ nbf: nowSeconds() + HOUR_S }), signingKey),
		],
		[
			"a token without an email",
			() => sign(claims({ email: undefined }), signingKey),
		],
		["a key the team never published", () => sign(claims(), otherSigningKey)],
		["a symmetric signature", () => sign(claims(), "shared-secret", "HS256")],
		[
			"a token without a key id",
			() => {
				const { kid: _kid, ...withoutKid } = signingKey;
				return sign(claims(), withoutKid);
			},
		],
		["garbage", async () => "not.a.token"],
	])("refuses %s", async (_name, make) => {
		expect(
			await verifyOperator(await make(), config, serving([publishedKey])),
		).toBeNull();
	});

	it("refuses everything while the keys cannot be fetched", async () => {
		const token = await sign(claims(), signingKey);
		expect(
			await verifyOperator(
				token,
				config,
				serving([publishedKey], HTTP_UNAVAILABLE),
			),
		).toBeNull();
		const broken: Fetch = async () => new Response("{}", { status: HTTP_OK });
		expect(await verifyOperator(token, config, broken)).toBeNull();
	});

	it("refuses an absent token and never fetches for it", async () => {
		const fetchImpl = serving([publishedKey]);
		expect(await verifyOperator(undefined, config, fetchImpl)).toBeNull();
		expect(await verifyOperator("", config, fetchImpl)).toBeNull();
		expect(fetchImpl.calls).toEqual([]);
	});

	it("stays closed while Access is not configured, whatever the token", async () => {
		const token = await sign(claims(), signingKey);
		const fetchImpl = serving([publishedKey]);
		const unconfigured = readConfig({
			...env,
			ACCESS_ISSUER: "",
			ACCESS_AUD: "",
		});
		expect(await verifyOperator(token, unconfigured, fetchImpl)).toBeNull();
		expect(fetchImpl.calls).toEqual([]);
	});
});
