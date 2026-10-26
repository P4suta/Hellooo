/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
export default {
	// pnpm keeps Stryker's own node_modules apart, so the runner is named instead of discovered.
	plugins: ["@stryker-mutator/vitest-runner"],
	testRunner: "vitest",
	vitest: { configFile: "vitest.stryker.config.ts" },
	mutate: ["src/core/**/*.ts"],
	coverageAnalysis: "perTest",
	concurrency: 2,
	// TypeScript 7 no longer exposes the tsconfig parser Stryker's sandbox copy would call, so mutants run in place with a backup.
	inPlace: true,
	tempDirName: ".stryker-tmp",
	reporters: ["clear-text", "progress"],
	// The release gate reads these: a survivor in the pure core is a missing test, never an accepted exception.
	thresholds: { high: 100, low: 95, break: 95 },
};
