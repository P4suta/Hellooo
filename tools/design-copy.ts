/**
 * Prints the copy and the service facts that the Figma design uses, as JSON, so the design scripts read the same catalog as the Worker.
 * `node tools/design-copy.ts` writes one object: the service name, operator, addresses, base URL, and both message catalogs with their placeholders filled by samples.
 */

import configuration from "../cloudflare.config.ts";
import { formatDate, SUPPORTED_LOCALES } from "../src/core/locale.ts";
import { MESSAGES } from "../src/core/messages.ts";
import { instant } from "../src/core/types.ts";

const SAMPLE_DATE_MS = Date.UTC(2027, 0, 14);
/** Pretty-printed output, so the JSON reads well when pasted into a design script. */
const JSON_INDENT = 2;
/** The counts a message with several numbers is rendered with. */
const SAMPLE_NUMBERS = ["12", "3", "40"];

type Env = Record<string, { readonly value?: string } | string>;

function text(env: Env, name: string): string {
	const binding = env[name];
	const value = typeof binding === "string" ? binding : binding?.value;
	if (value === undefined) {
		throw new Error(`cloudflare.config.ts declares no text binding ${name}`);
	}
	return value;
}

const resolved =
	typeof configuration === "function"
		? (configuration as (context: { mode: string }) => unknown)({
				mode: "production",
			})
		: configuration;
const env = (resolved as { worker: { env: Env } }).worker.env;
const service = {
	name: text(env, "SERVICE_NAME"),
	operator: text(env, "OPERATOR_NAME"),
	letters: text(env, "LETTERS_ADDRESS"),
	post: text(env, "NOTICES_ADDRESS"),
	baseUrl: text(env, "PUBLIC_BASE_URL"),
};

const maybeSampleDate = instant(SAMPLE_DATE_MS);
if (maybeSampleDate === null) {
	throw new Error("the sample date is not an instant");
}
const sampleDate = maybeSampleDate;

/** Replaces each message function with its text for the sample arguments, so the JSON holds only strings. */
function filled(
	value: unknown,
	locale: (typeof SUPPORTED_LOCALES)[number],
): unknown {
	if (typeof value === "function") {
		const render = value as (...arguments_: string[]) => string;
		if (render.length === 0) {
			return render("");
		}
		if (render.length > 1) {
			return render(...SAMPLE_NUMBERS);
		}
		return {
			operator: render(service.operator),
			service: render(service.name),
			address: render(service.letters),
			date: render(formatDate(locale, sampleDate)),
		};
	}
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, inner]) => [key, filled(inner, locale)]),
		);
	}
	return value;
}

const catalogs = Object.fromEntries(
	SUPPORTED_LOCALES.map((locale) => [locale, filled(MESSAGES[locale], locale)]),
);

process.stdout.write(
	`${JSON.stringify({ service, catalogs }, null, JSON_INDENT)}\n`,
);
