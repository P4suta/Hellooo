import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const D1_MIGRATIONS = "./migrations";
/** The batch and model-based tests run hundreds of D1 statements, which a shared CI runner has taken over ten seconds for. */
const WORKER_TEST_TIMEOUT_MS = 30_000;

export default defineConfig({
	test: {
		projects: [
			{
				test: {
					name: "core",
					environment: "node",
					include: ["test/core/**/*.test.ts"],
				},
			},
			{
				plugins: [
					cloudflareTest(async () => ({
						// The Worker is described by cloudflare.config.ts, which the plugin reads through this option.
						experimental: { newConfig: true },
						miniflare: {
							bindings: {
								TEST_MIGRATIONS: await readD1Migrations(D1_MIGRATIONS),
								// The tests replace the moderator, so the required secret only needs to exist.
								TYPESAFE_API_KEY: "test-only",
							},
						},
					})),
				],
				test: {
					name: "worker",
					include: ["test/worker/**/*.test.ts"],
					setupFiles: ["test/worker/apply-migrations.ts"],
					testTimeout: WORKER_TEST_TIMEOUT_MS,
				},
			},
		],
	},
});
