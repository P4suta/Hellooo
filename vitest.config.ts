import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const D1_MIGRATIONS = "./migrations";

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
				},
			},
		],
	},
});
