import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach } from "vitest";
import { z } from "zod";

const D1MigrationsSchema = z.array(
	z.object({ name: z.string(), queries: z.array(z.string()) }),
);

/** The migrations that vitest.config.ts reads from migrations/ and binds as TEST_MIGRATIONS. */
export function migrationsOf(
	bindings: object,
): z.infer<typeof D1MigrationsSchema> {
	return D1MigrationsSchema.parse(
		"TEST_MIGRATIONS" in bindings ? bindings.TEST_MIGRATIONS : undefined,
	);
}

/** Gives every test an empty database; storage otherwise persists across a file's tests. */
export function useEmptyStorage(): void {
	beforeEach(async () => {
		await reset();
		await applyD1Migrations(env.DB, migrationsOf(env));
	});
}
