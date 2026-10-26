import { DAY_MS } from "./duration.ts";
import { BODY_RETENTION_MS } from "./erasure.ts";
import type { Locale } from "./locale.ts";

/** The facts the terms and the privacy notice name, all of them configuration or constants of the core. */
export type LegalFacts = {
	readonly service: string;
	readonly operator: string;
	readonly contact: string;
	readonly jurisdiction: string;
};

export type LegalSection = {
	readonly heading: string;
	readonly lines: readonly string[];
};

export type LegalPage = {
	readonly title: string;
	readonly sections: readonly LegalSection[];
};

/** How many days a settled letter's text stays, as the privacy notice states it. */
export const RETENTION_DAYS = BODY_RETENTION_MS / DAY_MS;

/** The processors a letter or an address reaches, named so a reader can look them up. */
export const PROCESSORS = {
	hosting: "Cloudflare",
	moderation: "TypeSafe",
} as const;

/** The domain of the disclosed moderation processor; letter text travels there and nowhere else off the machine. */
export const MODERATION_PROCESSOR_DOMAIN = "typesafe.ai";

type LegalTexts = {
	readonly terms: (facts: LegalFacts) => LegalPage;
	readonly privacy: (facts: LegalFacts) => LegalPage;
};

const en: LegalTexts = {
	terms: ({ service, contact, jurisdiction }) => ({
		title: "Terms",
		sections: [
			{
				heading: "What this is",
				lines: [
					`${service} takes one letter a week from an address and brings it to one other address that also wrote one.`,
					"Writing to the address is agreeing to these terms.",
				],
			},
			{
				heading: "Letters",
				lines: [
					"A letter may contain no link, email address, or phone number.",
					"Letters that sell something, harass someone, expose a person, or break the law don't go out.",
					"A decision model reads every letter before it goes out, and the operator reads only reported letters.",
					"You keep the rights to what you write, and you let the service store it and bring it to one reader.",
				],
			},
			{
				heading: "Delivery",
				lines: [
					"The service doesn't promise that a letter arrives, or when.",
					"A letter may wait, be refused, or be lost when its writer is banned.",
				],
			},
			{
				heading: "Reports and bans",
				lines: [
					"A reader can report a letter they received.",
					"The operator may close a report or ban the writer, and a banned writer's letters stop.",
				],
			},
			{
				heading: "Stopping",
				lines: [
					"The page linked from every mail stops the letters.",
					"Your address stays recorded as stopped, so nothing reaches it again.",
				],
			},
			{
				heading: "Liability",
				lines: [
					"The service comes as it is, free of charge, with no warranty.",
					"The writer of a letter is responsible for its content.",
					"The operator isn't liable for a letter's content, for a letter that doesn't arrive, or for the service being unavailable.",
					"Where the law allows, the operator's liability is limited to what you paid, which is nothing.",
				],
			},
			{
				heading: "Changes and law",
				lines: [
					"These terms may change, and this page shows the current ones.",
					`The laws of ${jurisdiction} apply.`,
					`Questions go to ${contact}.`,
				],
			},
		],
	}),
	privacy: ({ service, operator, contact }) => ({
		title: "Privacy",
		sections: [
			{
				heading: "What is stored",
				lines: [
					`${service} stores your address, the language of your mail, the text of your letters, and the record of what happened to each: when it was taken, when it was delivered, who received it, and any report on it.`,
				],
			},
			{
				heading: "Why",
				lines: [
					"To check that an address is yours, to keep one letter a week, to bring a letter to one reader, and to act on reports.",
				],
			},
			{
				heading: "How long",
				lines: [
					`The text of a letter is erased ${RETENTION_DAYS} days after it is delivered or refused, unless a report on it is open.`,
					`A letter that is never confirmed or never accepted loses its text ${RETENTION_DAYS} days after it arrived.`,
					"Your address and the record of what happened stay while letters can reach you, and afterwards as a stopped address, so that nothing reaches it again.",
					`Write to ${contact} to have your address and your letters removed.`,
				],
			},
			{
				heading: "Who handles the data",
				lines: [
					`${PROCESSORS.hosting} hosts the service, receives and sends its mail, and stores the data.`,
					`${PROCESSORS.moderation}'s decision model receives the text of each letter to judge it, and nothing else.`,
					`The operator, ${operator}, can read reported letters and the records about them.`,
				],
			},
			{
				heading: "What isn't collected",
				lines: [
					"The pages set no cookies for readers and run no scripts.",
					"The logs keep no addresses and no letter text.",
				],
			},
			{
				heading: "Contact",
				lines: [`Questions and requests about your data go to ${contact}.`],
			},
		],
	}),
};

const ja: LegalTexts = {
	terms: ({ service, contact, jurisdiction }) => ({
		title: "利用規約",
		sections: [
			{
				heading: "このサービスについて",
				lines: [
					`${service} は、ひとつのアドレスから週に一通の手紙を預かり、同じように手紙を書いた別のアドレスへ届けます。`,
					"宛先へ手紙を書くことで、この規約に同意したことになります。",
				],
			},
			{
				heading: "手紙について",
				lines: [
					"手紙には、リンク、メールアドレス、電話番号を載せられません。",
					"勧誘、嫌がらせ、誰かを晒す内容、法に触れる内容の手紙は配達しません。",
					"配達の前に判定モデルがすべての手紙を読み、運営が読むのは通報された手紙だけです。",
					"書いた手紙の権利はあなたのもので、サービスがそれを保存して一人の読み手へ届けることを許すものとします。",
				],
			},
			{
				heading: "配達について",
				lines: [
					"手紙が届くこと、いつ届くことは約束しません。",
					"手紙は待たされることも、断られることも、書いた人が止められて失われることもあります。",
				],
			},
			{
				heading: "通報と停止",
				lines: [
					"受け取った手紙は通報できます。",
					"運営は通報を閉じるか、書いた人を止めることができ、止められた人の手紙は配達されなくなります。",
				],
			},
			{
				heading: "受け取りをやめること",
				lines: [
					"どのメールからもたどれるページで、受け取りをやめることができます。",
					"やめたアドレスは、二度と手紙が届かないように、やめた状態のまま記録されます。",
				],
			},
			{
				heading: "責任について",
				lines: [
					"このサービスは無料で、現状のまま、保証なしに提供されます。",
					"手紙の内容の責任は、書いた人にあります。",
					"運営は、手紙の内容、届かなかった手紙、サービスが使えない時間について責任を負いません。",
					"法が許す範囲で、運営の責任はあなたが支払った額、つまり無料の範囲に限られます。",
				],
			},
			{
				heading: "変更と準拠法",
				lines: [
					"この規約は変わることがあり、このページに現在の規約を載せます。",
					`準拠法は${jurisdiction}の法です。`,
					`問い合わせは ${contact} へどうぞ。`,
				],
			},
		],
	}),
	privacy: ({ service, operator, contact }) => ({
		title: "プライバシー",
		sections: [
			{
				heading: "保存するもの",
				lines: [
					`${service} は、あなたのアドレス、メールの言語、手紙の本文、そして各手紙に起きたことの記録（預かった時刻、届けた時刻、届けた相手、通報）を保存します。`,
				],
			},
			{
				heading: "目的",
				lines: [
					"アドレスがあなたのものだと確かめること、週に一通を守ること、手紙を一人の読み手へ届けること、通報に対応することのためです。",
				],
			},
			{
				heading: "保存する期間",
				lines: [
					`手紙の本文は、配達または却下から ${RETENTION_DAYS} 日後に消します。ただし通報が開いている間は残します。`,
					`確認されなかった手紙や、受理されなかった手紙の本文は、届いてから ${RETENTION_DAYS} 日後に消します。`,
					"あなたのアドレスと記録は、手紙を受け取れる間と、やめたあとも二度と届かないようにするために残ります。",
					`アドレスと手紙の削除は ${contact} へ書いてください。`,
				],
			},
			{
				heading: "データを扱う相手",
				lines: [
					`${PROCESSORS.hosting} がサービスを動かし、メールの受信と送信を行い、データを保存します。`,
					`${PROCESSORS.moderation} の判定モデルが、各手紙の本文だけを受け取って判定します。`,
					`運営（${operator}）は、通報された手紙とその記録を読むことができます。`,
				],
			},
			{
				heading: "集めないもの",
				lines: [
					"ページは読み手に cookie を置かず、スクリプトも動かしません。",
					"ログにはアドレスも手紙の本文も残しません。",
				],
			},
			{
				heading: "問い合わせ",
				lines: [`データについての質問と要望は ${contact} へどうぞ。`],
			},
		],
	}),
};

const LEGAL: Readonly<Record<Locale, LegalTexts>> = { en, ja };

export function termsPage(locale: Locale, facts: LegalFacts): LegalPage {
	return LEGAL[locale].terms(facts);
}

export function privacyPage(locale: Locale, facts: LegalFacts): LegalPage {
	return LEGAL[locale].privacy(facts);
}
