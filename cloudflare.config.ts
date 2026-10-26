import { bindings, defineConfig, triggers } from "cf/config";

// A letter is written to anybody, and everything the service sends comes from post.
// The pages live on www, and a Cloudflare redirect rule sends the bare domain there; mail keeps the bare domain.
const LETTERS_ADDRESS = "anybody@hellooo.email";
const NOTICES_ADDRESS = "post@hellooo.email";
const PUBLIC_BASE_URL = "https://www.hellooo.email";
// TypeSafe's Jev; Cloudflare's Clef accepts the same request shape through its own endpoint.
const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
// The stub that the end-to-end tests run on this machine in place of Jev, and in place of the Access team that signs operator tokens.
const E2E_STUB_ORIGIN = "http://127.0.0.1:5198";
const E2E_MODERATION_ENDPOINT = `${E2E_STUB_ORIGIN}/systemone`;
const E2E_ACCESS_AUD = "hellooo-operator-e2e";
// The Cloudflare Access team domain and the audience tag of the self-hosted application "Hellooo operator" that guards /admin.
// Emptying either closes the operator pages to everyone with a 401.
const ACCESS_ISSUER = "https://yasunobu.cloudflareaccess.com";
const ACCESS_AUD =
	"d4ad7b0b0f7ee4716fca3238df03f944a0af9adff3412108e58bc8a39bfff70f";
// `cf dev` keys its local D1 database by this id, and `just migrate-local` applies ./migrations to the same id.
// Production omits the id, so the first deploy provisions the database by name.
const LOCAL_DATABASE_ID = "00000000-0000-4000-8000-000000000001";
// The modes that publish to the real domain and database: the open service, and the closed one that `just close` deploys while the service is off.
const LIVE_MODES: ReadonlySet<string | undefined> = new Set([
	"production",
	"closed",
]);

export default defineConfig(({ mode }) => ({
	worker: {
		name: "hellooo",
		compatibilityDate: "2026-10-24",
		// Without this flag, a fetch to a host in the Worker's own zone would skip the front door and reach that zone's origin past its WAF and Access rules.
		compatibilityFlags: ["global_fetch_strictly_public"],
		entrypoint: "./src/worker/index.ts",
		// The pages' host is a custom domain of the Worker, which `cf deploy` attaches with its DNS record and certificate; local modes serve on the dev origin.
		...(LIVE_MODES.has(mode)
			? { domains: [new URL(PUBLIC_BASE_URL).host] }
			: {}),
		// Letter bodies and addresses never enter logs, so only redacted invocation metadata is kept.
		observability: {
			enabled: true,
			redactQueryString: true,
			issues: { enabled: false },
			logs: { enabled: true, invocationLogs: false, persist: false },
			traces: { enabled: false },
		},
		triggers: [
			// Each run delivers the letters whose journey has ended.
			triggers.scheduled({ schedule: "*/15 * * * *" }),
			// Email Routing hands mail for the letters address to the email handler.
			triggers.email({ addresses: [LETTERS_ADDRESS] }),
		],
		env: {
			SERVICE_NAME: bindings.text("Hellooo"),
			OPERATOR_NAME: bindings.text("the Hellooo operator"),
			SERVICE_CLOSED: bindings.text(mode === "closed" ? "true" : "false"),
			LEGAL_JURISDICTION: bindings.text("JP"),
			LETTERS_ADDRESS: bindings.text(LETTERS_ADDRESS),
			NOTICES_ADDRESS: bindings.text(NOTICES_ADDRESS),
			PUBLIC_BASE_URL: bindings.text(PUBLIC_BASE_URL),
			MODERATION_ENDPOINT: bindings.text(
				mode === "e2e" ? E2E_MODERATION_ENDPOINT : JEV_ENDPOINT,
			),
			MODERATION_MODEL: bindings.text("jev-latest"),
			ACCESS_ISSUER: bindings.text(
				mode === "e2e" ? E2E_STUB_ORIGIN : ACCESS_ISSUER,
			),
			ACCESS_AUD: bindings.text(mode === "e2e" ? E2E_ACCESS_AUD : ACCESS_AUD),
			// TypeSafe's Jev key, held in Doppler: `just dev` injects it into `cf dev`, and `just deploy` mounts it for `cf deploy --secrets-file`.
			TYPESAFE_API_KEY: bindings.secret(),
			// Users, letters, deliveries, and events.
			DB: bindings.d1(
				LIVE_MODES.has(mode)
					? { name: "hellooo" }
					: { name: "hellooo", id: LOCAL_DATABASE_ID },
			),
			// Outbound letters and confirmation links leave through Email Sending; `cf dev` logs them instead of sending.
			EMAIL: bindings.sendEmail({}),
		},
	},
}));
