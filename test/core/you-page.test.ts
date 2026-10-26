import { describe, expect, it } from "vitest";
import { USER_STATUSES } from "../../src/core/types.ts";
import { youControls, youView } from "../../src/core/you-page.ts";

describe("the page about an address", () => {
	it("waits for a pending address, receives for an active one, and is stopped for every other state", () => {
		expect(youView("pending")).toBe("waiting");
		expect(youView("active")).toBe("receiving");
		for (const status of ["unsubscribed", "suppressed", "banned"] as const) {
			expect(youView(status)).toBe("stopped");
		}
	});

	it("offers the language switch and the stop exactly while letters can still arrive", () => {
		for (const status of USER_STATUSES) {
			expect(youControls(status)).toBe(youView(status) !== "stopped");
		}
		expect(USER_STATUSES.filter(youControls)).toEqual(["pending", "active"]);
	});
});
