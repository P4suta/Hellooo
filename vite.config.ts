import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

const DEFAULT_PORT = 5173;
/** The IPv4 loopback, so `just intake-sample` and the end-to-end run reach the server by one address. */
const LOOPBACK_HOST = "127.0.0.1";
// The end-to-end run starts its own dev server on another port with its own state directory.
const { HELLOOO_DEV_PORT, HELLOOO_STATE_DIR } = process.env;
/** The state directory `just migrate-local` applies the migrations to, so the dev server opens the same local D1 database. */
const LOCAL_STATE_DIR = ".cloudflare/state";

export default defineConfig({
	plugins: [
		cloudflare({
			persistState: { path: HELLOOO_STATE_DIR ?? LOCAL_STATE_DIR },
		}),
	],
	server: {
		host: LOOPBACK_HOST,
		port:
			HELLOOO_DEV_PORT === undefined ? DEFAULT_PORT : Number(HELLOOO_DEV_PORT),
		strictPort: true,
	},
	// `cf deploy` uploads the source maps found in the build output.
	build: { sourcemap: true },
});
