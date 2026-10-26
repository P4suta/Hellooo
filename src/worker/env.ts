import { z } from "zod";
import { normalizeEmailAddress } from "../core/email-address.ts";
import { MODERATION_PROCESSOR_DOMAIN } from "../core/legal.ts";

/** Hosts that leave the machine for nobody, so a local stub may stand in for the processor. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"]);

/** Whether letter text sent to this URL reaches only the processor the privacy notice names, or stays on the machine. */
function reachesDisclosedProcessor(endpoint: string): boolean {
	const { hostname } = new URL(endpoint);
	return (
		hostname === MODERATION_PROCESSOR_DOMAIN ||
		hostname.endsWith(`.${MODERATION_PROCESSOR_DOMAIN}`) ||
		LOOPBACK_HOSTS.has(hostname)
	);
}

/** A service address under the same rules as a sender's, so comparisons between the two are exact. */
const Address = z.string().transform((raw, ctx) => {
	const address = normalizeEmailAddress(raw);
	if (address === null) {
		ctx.addIssue({ code: "custom", message: "not a deliverable address" });
		return z.NEVER;
	}
	return address;
});

const ConfigSchema = z.object({
	SERVICE_NAME: z.string().min(1),
	OPERATOR_NAME: z.string().min(1),
	/** The region whose law the terms name, as an ISO 3166-1 alpha-2 code that each language spells out itself. */
	LEGAL_JURISDICTION: z.string().regex(/^[A-Z]{2}$/),
	LETTERS_ADDRESS: Address,
	NOTICES_ADDRESS: Address,
	PUBLIC_BASE_URL: z.url(),
	MODERATION_ENDPOINT: z.url().refine(reachesDisclosedProcessor, {
		message:
			"letter text may travel only to the disclosed moderation processor",
	}),
	MODERATION_MODEL: z.string().min(1),
	TYPESAFE_API_KEY: z.string().min(1).optional(),
	/** The Cloudflare Access team domain that signs operator requests; empty keeps the operator pages closed. */
	ACCESS_ISSUER: z.union([z.literal(""), z.url()]),
	/** The audience tag of the Access application in front of the operator pages; empty keeps them closed. */
	ACCESS_AUD: z.string(),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Validates the Worker's variables and the moderation secret once per invocation; a misconfigured deployment fails loudly here.
 * The parameter is untyped on purpose: the schema, not the generated binding types, decides what the Worker runs with.
 */
export function readConfig(env: unknown): Config {
	return ConfigSchema.parse(env);
}

/** The pages a mail links to; each one is opened by the key that names an address or a letter. */
export type PublicPath = "verify" | "confirm" | "you" | "stop" | "report";

/** The root-relative path of a page, as forms on the Worker's own pages address it. */
export function publicPath(path: PublicPath, key: string): string {
	return `/${path}/${encodeURIComponent(key)}`;
}

/** The absolute link into the Worker's own pages, as a mail carries it; the key is all that travels in the URL. */
export function publicLink(
	config: Config,
	path: PublicPath,
	key: string,
): string {
	return new URL(publicPath(path, key), config.PUBLIC_BASE_URL).toString();
}

export type OperatorAccess = {
	readonly issuer: string;
	readonly aud: string;
};

/** The Access application that identifies the operator, or null while both settings are empty and the operator pages stay closed. */
export function operatorAccess(config: Config): OperatorAccess | null {
	if (config.ACCESS_ISSUER === "" || config.ACCESS_AUD === "") {
		return null;
	}
	return {
		issuer: config.ACCESS_ISSUER.replace(/\/+$/, ""),
		aud: config.ACCESS_AUD,
	};
}
