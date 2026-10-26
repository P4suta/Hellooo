import { defineConfig } from "vitest/config";

// Stryker mutates src/core only, and the core tests run in Node without the Workers runtime.
export default defineConfig({
	test: {
		environment: "node",
		include: ["test/core/**/*.test.ts"],
	},
});
