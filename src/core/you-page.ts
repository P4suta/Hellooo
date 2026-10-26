import type { UserStatus } from "./types.ts";

/** What the page about one address says: the address waits for its confirmation, receives letters, or no longer does. */
export type YouView = "waiting" | "receiving" | "stopped";

export function youView(status: UserStatus): YouView {
	switch (status) {
		case "pending":
			return "waiting";
		case "active":
			return "receiving";
		case "unsubscribed":
		case "suppressed":
		case "banned":
			return "stopped";
	}
}

/** The language switch and the stop control exist only while letters can still arrive. */
export function youControls(status: UserStatus): boolean {
	return youView(status) !== "stopped";
}
