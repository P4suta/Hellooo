import { env } from "cloudflare:workers";
import { readConfig } from "../../src/worker/env.ts";

export type RawMailOptions = {
	readonly from?: string;
	/** The `From` header when it should differ from the envelope sender. */
	readonly headerFrom?: string;
	readonly to?: string;
	readonly subject?: string;
	readonly body: string;
	readonly dmarc?: "pass" | "fail" | "none" | "absent";
	readonly contentType?: string;
	readonly contentLanguage?: string;
	readonly extraHeaders?: readonly string[];
};

let sequence = 0;

/** An RFC 5322 message as Cloudflare would hand it to the email handler, with its own Authentication-Results on top. */
export function rawMail(options: RawMailOptions): string {
	sequence += 1;
	const from = options.from ?? "writer@example.com";
	const to = options.to ?? readConfig(env).LETTERS_ADDRESS;
	const dmarc = options.dmarc ?? "pass";
	const headers: string[] = [];
	if (dmarc !== "absent") {
		headers.push(
			`Authentication-Results: mx.cloudflare.net; dkim=${dmarc === "pass" ? "pass" : "fail"} header.d=example.com; spf=pass smtp.mailfrom=example.com; dmarc=${dmarc} header.from=example.com`,
		);
	}
	headers.push(...(options.extraHeaders ?? []));
	headers.push(
		`From: ${options.headerFrom ?? from}`,
		`To: ${to}`,
		`Subject: ${options.subject ?? "Hellooo"}`,
		"Date: Sat, 25 Oct 2026 12:00:00 +0900",
		`Message-ID: <raw-${sequence}@example.com>`,
		"MIME-Version: 1.0",
		`Content-Type: ${options.contentType ?? "text/plain; charset=utf-8"}`,
		"Content-Transfer-Encoding: 8bit",
	);
	if (options.contentLanguage !== undefined) {
		headers.push(`Content-Language: ${options.contentLanguage}`);
	}
	return `${headers.join("\r\n")}\r\n\r\n${options.body}\r\n`;
}
