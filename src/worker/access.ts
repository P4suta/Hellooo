import { verifyWithJwks } from "hono/jwt";
import type { HonoJsonWebKey } from "hono/utils/jwt/jws";
import { z } from "zod";
import { type Config, operatorAccess } from "./env.ts";
import type { Fetch } from "./moderation.ts";

export type Operator = { readonly email: string };

/** Where a Cloudflare Access team publishes the keys that sign its tokens. */
const CERTS_PATH = "/cdn-cgi/access/certs";
/** Access signs with RSA; a token claiming any other algorithm is refused before its key is looked up. */
const ALLOWED_ALGORITHMS = ["RS256"] as const;

/** A published key is a JSON Web Key with the `kid` that a token's header names. */
const KeysSchema = z.object({
	keys: z.array(
		z.custom<HonoJsonWebKey>(
			(value) =>
				typeof value === "object" &&
				value !== null &&
				"kid" in value &&
				typeof value.kid === "string" &&
				value.kid.length > 0,
		),
	),
});
const ClaimsSchema = z.object({ email: z.string().min(1) });

/**
 * Identifies the operator behind a request through the token that Cloudflare Access signs for the configured application.
 * The signature, issuer, audience, and validity window are checked against the team's published keys.
 * Anything else answers null, and neither the token nor its claims reach a log.
 */
export async function verifyOperator(
	token: string | undefined,
	config: Config,
	fetchImpl: Fetch = fetch,
): Promise<Operator | null> {
	const access = operatorAccess(config);
	if (access === null || token === undefined || token === "") {
		return null;
	}
	try {
		const response = await fetchImpl(`${access.issuer}${CERTS_PATH}`, {
			method: "GET",
		});
		if (!response.ok) {
			throw new Error(`the Access keys answered ${response.status}`);
		}
		const { keys } = KeysSchema.parse(await response.json());
		const claims = await verifyWithJwks(token, {
			keys,
			verification: { iss: access.issuer, aud: access.aud },
			allowedAlgorithms: ALLOWED_ALGORITHMS,
		});
		return { email: ClaimsSchema.parse(claims).email };
	} catch (error) {
		console.warn(
			"operator not identified",
			error instanceof Error ? error.name : "unknown failure",
		);
		return null;
	}
}
