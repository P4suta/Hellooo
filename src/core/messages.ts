import type { LetterTextProblem } from "./letter-text.ts";
import type { Locale } from "./locale.ts";

type Titled = { readonly title: string; readonly body: string };

/** Every piece of text a reader sees, so a locale is complete only when it fills every field. */
export type Messages = {
	readonly mail: {
		readonly verification: { readonly subject: string; readonly intro: string };
		readonly confirmation: { readonly subject: string; readonly intro: string };
		readonly accepted: {
			readonly subject: string;
			readonly begun: string;
			readonly maybe: string;
		};
		readonly overCap: {
			readonly subject: string;
			readonly dropped: string;
			readonly writeAgain: (date: string) => string;
		};
		readonly cannotTravel: {
			readonly subject: string;
			readonly problems: Readonly<Record<LetterTextProblem, string>>;
			readonly rewrite: string;
			readonly refused: string;
			readonly another: string;
		};
		readonly exhausted: { readonly subject: string; readonly resting: string };
		readonly delivery: {
			readonly subject: string;
			readonly footer: (service: string) => string;
			readonly report: string;
		};
		/** The line before the link to the page about the reader's own address. */
		readonly you: string;
	};
	readonly web: {
		readonly front: {
			readonly hello: string;
			readonly anybody: string;
			/** The one sentence that says what to do, with the address inside it, which the page renders as a link. */
			readonly write: (address: string) => string;
			readonly rules: string;
			readonly only: string;
			readonly next: string;
			readonly operated: (operator: string) => string;
			readonly contact: string;
		};
		readonly unknown: Titled;
		readonly verify: {
			readonly used: Titled;
			readonly confirmed: {
				readonly title: string;
				readonly traveling: string;
				readonly next: (address: string) => string;
			};
		};
		readonly confirm: {
			readonly used: Titled;
			readonly confirmed: {
				readonly title: string;
				readonly traveling: string;
				readonly refused: string;
			};
		};
		readonly you: {
			readonly waiting: string;
			readonly receiving: string;
			readonly stopped: string;
			readonly farewell: string;
			/** The control that switches the reader's mail to each language, worded in the reader's current language. */
			readonly switchTo: Readonly<Record<Locale, string>>;
			readonly stop: string;
		};
		readonly report: { readonly thanks: Titled; readonly unknown: Titled };
		readonly operator: {
			readonly title: string;
			readonly signIn: Titled;
			readonly numbers: (
				receiving: string,
				onTheirWay: string,
				delivered: string,
			) => string;
			readonly reported: string;
			readonly nothingReported: string;
			readonly reports: (count: string) => string;
			/** Shown in place of a reported letter whose text was erased before the report came. */
			readonly erased: string;
			readonly ban: string;
			readonly close: string;
		};
	};
};

const en: Messages = {
	mail: {
		verification: {
			subject: "is this you?",
			intro:
				"Thanks for writing. Opening the link below sends letters from this address on their way.",
		},
		confirmation: {
			subject: "is this letter yours?",
			intro:
				"A letter came from your address. Opening the link below sends it on its way.",
		},
		accepted: {
			subject: "your letter is on its way",
			begun: "Your letter is on its way.",
			maybe: "It may reach someone before long.",
		},
		overCap: {
			subject: "one letter a week",
			dropped: "This week's letter has already gone out, so this one doesn't.",
			writeAgain: (date) => `Another can be written on or after ${date}.`,
		},
		cannotTravel: {
			subject: "this letter can't go out",
			problems: {
				empty: "There were no words in it.",
				url: "It contains a link.",
				"email-address": "It contains an email address.",
				"phone-number": "It contains a phone number.",
			},
			rewrite:
				"Letters go out without links, email addresses, or phone numbers. Without them, it can be sent again.",
			refused:
				"Letters that sell something, harass someone, or expose a person don't go out.",
			another: "A different letter can be sent any time.",
		},
		exhausted: {
			subject: "nothing more today",
			resting:
				"Several letters from you couldn't go out today. Tomorrow it is possible again.",
		},
		delivery: {
			subject: "a letter for you",
			footer: (service) =>
				`Somebody wrote this to anybody, and ${service} brought it to you.`,
			report: "Report this letter:",
		},
		you: "Your language, or no more letters:",
	},
	web: {
		front: {
			hello: "Hellooo?",
			anybody: "Anybody there?",
			write: (address) =>
				`Write a letter to ${address}, and it reaches somebody, somewhere in this world.`,
			rules: "A letter can be sent once a week.",
			only: "By writing a letter, you may receive one too.",
			next: "Next",
			operated: (operator) => `Operated by ${operator}.`,
			contact: "Questions and reports:",
		},
		unknown: {
			title: "Unknown link",
			body: "This link doesn't lead anywhere.",
		},
		verify: {
			used: {
				title: "This link was used already",
				body: "It was opened before, or it has expired. Writing again creates a new one.",
			},
			confirmed: {
				title: "Confirmed",
				traveling: "Your address is confirmed and your letter is on its way.",
				next: (address) =>
					`Your address is confirmed. The next letter you write to ${address} goes out.`,
			},
		},
		confirm: {
			used: {
				title: "This link was used already",
				body: "The letter was confirmed or discarded before.",
			},
			confirmed: {
				title: "Confirmed",
				traveling: "Your letter is on its way.",
				refused:
					"The letter is yours, but it can't go out as written. A mail explains why.",
			},
		},
		you: {
			waiting:
				"This address isn't confirmed yet. The link in the first mail confirms it.",
			receiving: "Letters reach this address.",
			stopped: "No letter reaches this address.",
			farewell: "Thank you for writing.",
			switchTo: { en: "Receive in English", ja: "Receive in Japanese" },
			stop: "No more letters",
		},
		report: {
			thanks: { title: "Thank you", body: "The report is received." },
			unknown: {
				title: "Unknown letter",
				body: "This link doesn't match a delivered letter.",
			},
		},
		operator: {
			title: "Operator",
			signIn: {
				title: "Not signed in",
				body: "This page opens for the operator only.",
			},
			numbers: (receiving, onTheirWay, delivered) =>
				`${receiving} receiving, ${onTheirWay} on their way, ${delivered} delivered.`,
			reported: "Reported letters",
			nothingReported: "No letter is reported.",
			reports: (count) => `Reported ${count} times.`,
			erased: "The text is no longer kept.",
			ban: "Ban the writer",
			close: "Close",
		},
	},
};

const ja: Messages = {
	mail: {
		verification: {
			subject: "このアドレスはあなたのものですか",
			intro:
				"手紙をありがとうございます。下のリンクを開くと、このアドレスからの手紙が配達に出ます。",
		},
		confirmation: {
			subject: "この手紙はあなたのものですか",
			intro:
				"あなたのアドレスから手紙が届きました。下のリンクを開くと、配達に出ます。",
		},
		accepted: {
			subject: "手紙をお預かりしました",
			begun: "手紙をお預かりしました。",
			maybe: "近いうちに、誰かに届くかもしれません。",
		},
		overCap: {
			subject: "手紙は週に1通です",
			dropped: "今週の手紙はすでに配達に出ているので、この手紙は配達しません。",
			writeAgain: (date) => `${date}以降に、また書くことができます。`,
		},
		cannotTravel: {
			subject: "この手紙は配達できません",
			problems: {
				empty: "手紙に言葉がありませんでした。",
				url: "リンクが含まれています。",
				"email-address": "メールアドレスが含まれています。",
				"phone-number": "電話番号が含まれています。",
			},
			rewrite:
				"手紙にはリンク、メールアドレス、電話番号を載せられません。それらを除けば、もう一度送ることができます。",
			refused: "勧誘、嫌がらせ、誰かを晒す手紙は配達しません。",
			another: "別の手紙は、いつでも送ることができます。",
		},
		exhausted: {
			subject: "今日はここまでです",
			resting:
				"今日はあなたの手紙を何通か配達できませんでした。明日、また送ることができます。",
		},
		delivery: {
			subject: "あなたに手紙です",
			footer: (service) =>
				`誰かが、誰かに宛てて書いた手紙を、${service} がお届けしました。`,
			report: "この手紙を通報する:",
		},
		you: "言語の変更と、受け取りの停止:",
	},
	web: {
		front: {
			hello: "Hellooo?",
			anybody: "誰かいますか？",
			write: (address) =>
				`${address} にメールを書くと、この世のどこかの誰かに届きます。`,
			rules: "週に一度、送ることができます。",
			only: "手紙を書くことで、あなたにも手紙が届くかもしれません。",
			next: "次へ",
			operated: (operator) => `運営: ${operator}`,
			contact: "問い合わせと通報:",
		},
		unknown: {
			title: "リンクが見つかりません",
			body: "このリンクは、どこにもつながっていません。",
		},
		verify: {
			used: {
				title: "使用済みのリンクです",
				body: "すでに開かれたか、期限が切れています。もう一度手紙を書くと、新しいリンクが届きます。",
			},
			confirmed: {
				title: "確認しました",
				traveling: "アドレスを確認しました。手紙は配達に出ます。",
				next: (address) =>
					`アドレスを確認しました。次に ${address} へ書く手紙が配達に出ます。`,
			},
		},
		confirm: {
			used: {
				title: "使用済みのリンクです",
				body: "この手紙はすでに確認されたか、破棄されています。",
			},
			confirmed: {
				title: "確認しました",
				traveling: "手紙は配達に出ます。",
				refused:
					"手紙はあなたのものでしたが、このままでは配達できません。理由はメールでお知らせします。",
			},
		},
		you: {
			waiting:
				"このアドレスはまだ確認されていません。最初のメールのリンクで確認できます。",
			receiving: "手紙はこのアドレスに届きます。",
			stopped: "このアドレスに手紙は届きません。",
			farewell: "手紙をありがとうございました。",
			switchTo: { en: "英語で受け取る", ja: "日本語で受け取る" },
			stop: "手紙の受け取りをやめる",
		},
		report: {
			thanks: { title: "ありがとうございます", body: "通報を受け取りました。" },
			unknown: {
				title: "手紙が見つかりません",
				body: "このリンクは、届いた手紙と一致しません。",
			},
		},
		operator: {
			title: "運営",
			signIn: {
				title: "サインインしていません",
				body: "運営だけが開けるページです。",
			},
			numbers: (receiving, onTheirWay, delivered) =>
				`手紙を受け取る人は${receiving}人、配達に出ている手紙は${onTheirWay}通、届いた手紙は${delivered}通です。`,
			reported: "通報された手紙",
			nothingReported: "通報された手紙はありません。",
			reports: (count) => `通報${count}件。`,
			erased: "本文はもう残っていません。",
			ban: "書いた人を止める",
			close: "閉じる",
		},
	},
};

export const MESSAGES: Readonly<Record<Locale, Messages>> = { en, ja };

export function messagesFor(locale: Locale): Messages {
	return MESSAGES[locale];
}
