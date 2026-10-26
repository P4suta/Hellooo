import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
	MODERATION_QUESTIONS,
	REJECT_AT,
} from "../../src/core/moderation-verdict.ts";
import { type Config, readConfig } from "../../src/worker/env.ts";
import {
	type Fetch,
	jevRequest,
	moderateWithJev,
} from "../../src/worker/moderation.ts";

const HTTP_OK = 200;
const HTTP_FOUND = 302;
const HTTP_UNPROCESSABLE = 422;
const HTTP_SERVER_ERROR = 500;
const LETTER = "Hellooo? Anybody there?";

const config: Config = readConfig({ ...env, TYPESAFE_API_KEY: "secret-key" });

type Captured = { url: string; init: RequestInit };

function answering(
	probabilities:
		| number
		| Partial<Record<keyof typeof MODERATION_QUESTIONS, number>>,
	captured: Captured[] = [],
): Fetch {
	return async (url, init) => {
		captured.push({ url, init });
		const body = JSON.parse(String(init.body)) as {
			questions: Record<string, unknown>;
		};
		const answers = Object.fromEntries(
			Object.keys(body.questions).map((id) => [
				id,
				{
					type: "noul",
					noul:
						typeof probabilities === "number"
							? probabilities
							: (probabilities[id as keyof typeof MODERATION_QUESTIONS] ?? 0),
				},
			]),
		);
		return Response.json(
			{
				model: "jev-latest",
				answers,
				usage: { input_tokens: 1, output_tokens: 1 },
			},
			{ status: HTTP_OK },
		);
	};
}

describe("jevRequest", () => {
	it("names the model, carries the letter as state, and asks one noul question per rule", () => {
		const request = jevRequest("jev-latest", LETTER) as {
			model: string;
			state: string;
			questions: Record<string, { type: string; instructions: string }>;
		};
		expect(request.model).toBe("jev-latest");
		expect(request.state).toBe(LETTER);
		expect(Object.keys(request.questions).sort()).toEqual(
			Object.keys(MODERATION_QUESTIONS).sort(),
		);
		for (const [id, question] of Object.entries(request.questions)) {
			expect(question.type).toBe("noul");
			expect(question.instructions).toBe(
				MODERATION_QUESTIONS[id as keyof typeof MODERATION_QUESTIONS],
			);
		}
	});
});

describe("moderateWithJev", () => {
	it("posts JSON to the TypeSafe endpoint with the bearer key", async () => {
		const captured: Captured[] = [];
		await moderateWithJev(config, LETTER, answering(0, captured));
		expect(captured).toHaveLength(1);
		const [call] = captured;
		expect(call?.url).toBe("https://api.typesafe.ai/v1/systemone");
		expect(call?.init.method).toBe("POST");
		const headers = new Headers(call?.init.headers);
		expect(headers.get("authorization")).toBe("Bearer secret-key");
		expect(headers.get("content-type")).toBe("application/json");
		expect(JSON.parse(String(call?.init.body))).toEqual(
			jevRequest("jev-latest", LETTER),
		);
	});

	it("never follows a redirect and bounds the wait", async () => {
		const captured: Captured[] = [];
		await moderateWithJev(config, LETTER, answering(0, captured));
		const [call] = captured;
		expect(call?.init.redirect).toBe("manual");
		expect(call?.init.signal).toBeInstanceOf(AbortSignal);
		const redirecting: Fetch = async () =>
			new Response(null, {
				status: HTTP_FOUND,
				headers: { location: "https://elsewhere.example/" },
			});
		expect(await moderateWithJev(config, LETTER, redirecting)).toBeNull();
	});

	it("delivers or rejects by the threshold", async () => {
		expect(await moderateWithJev(config, LETTER, answering(0.1))).toBe(
			"deliver",
		);
		expect(await moderateWithJev(config, LETTER, answering(0.9))).toBe(
			"reject",
		);
		expect(
			await moderateWithJev(config, LETTER, answering({ sells: REJECT_AT })),
		).toBe("reject");
		expect(
			await moderateWithJev(
				config,
				LETTER,
				answering({ targetsPerson: REJECT_AT - Number.EPSILON }),
			),
		).toBe("deliver");
	});

	it("gives no verdict when the key is missing, without calling out", async () => {
		const captured: Captured[] = [];
		const { TYPESAFE_API_KEY: _unused, ...withoutKey } = config;
		expect(
			await moderateWithJev(withoutKey, LETTER, answering(0, captured)),
		).toBeNull();
		expect(captured).toHaveLength(0);
	});

	it.each<[string, Fetch]>([
		[
			"a server error",
			async () => new Response("down", { status: HTTP_SERVER_ERROR }),
		],
		[
			"a validation error",
			async () =>
				Response.json(
					{ detail: [{ msg: "Field required" }] },
					{ status: HTTP_UNPROCESSABLE },
				),
		],
		[
			"a body that is not JSON",
			async () => new Response("<html>oops</html>", { status: HTTP_OK }),
		],
		[
			"a probability outside [0, 1]",
			async () =>
				Response.json({ answers: { sells: { type: "noul", noul: 2 } } }),
		],
		[
			"a missing question",
			async () =>
				Response.json({ answers: { sells: { type: "noul", noul: 0 } } }),
		],
		[
			"an answer of another type",
			async () =>
				Response.json({
					answers: { sells: { type: "choice", choice: "yes" } },
				}),
		],
		[
			"a network failure",
			async () => {
				throw new TypeError("fetch failed");
			},
		],
	])("gives no verdict on %s", async (_name, failing) => {
		expect(await moderateWithJev(config, LETTER, failing)).toBeNull();
	});
});
