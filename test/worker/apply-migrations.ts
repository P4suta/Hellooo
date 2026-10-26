import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { migrationsOf } from "./d1.ts";

// Setup files run before every test file; applyD1Migrations skips migrations that are already applied.
await applyD1Migrations(env.DB, migrationsOf(env));
