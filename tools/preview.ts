/**
 * Runs the Worker the way the end-to-end tests do, for looking at it in a browser: `cf dev --mode e2e` with the stub decision model and the stub Access team.
 * `node tools/preview.ts` prints the front page and the operator's sign-in, then runs until interrupted.
 */

import setup, { DEV_ORIGIN, STUB_ORIGIN } from "../test/e2e/global-setup.ts";

const stop = await setup();
process.stdout.write(`front page   ${DEV_ORIGIN}/\n`);
process.stdout.write(`operator     ${STUB_ORIGIN}/e2e/sign-in\n`);
process.stdout.write("press Ctrl-C to stop\n");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		stop().finally(() => process.exit(0));
	});
}
