import { defineConfig } from "vitest/config";

const TEST_TIMEOUT_MS = 60_000;
const HOOK_TIMEOUT_MS = 240_000;

// `just e2e` starts `cf dev` and a stub decision model, then drives the real Worker over HTTP.
export default defineConfig({
	test: {
		name: "e2e",
		environment: "node",
		include: ["test/e2e/**/*.test.ts"],
		globalSetup: ["test/e2e/global-setup.ts"],
		testTimeout: TEST_TIMEOUT_MS,
		hookTimeout: HOOK_TIMEOUT_MS,
		fileParallelism: false,
	},
});
