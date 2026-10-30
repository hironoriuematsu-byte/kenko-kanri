// ============================================================
// 健診結果の医師意見聴取Web(50人未満の事業場向け・Web申込)の料金・入力チェック・宣伝文
// 画面(宣伝ページ・申込フォーム)とサーバー(決済の作成・開設処理)で同じ計算を使う。金額はすべて税込・円。
// ============================================================

import { getFiscalYear } from "@/lib/fiscal";
import { IKEN_RETURN_DAYS } from "@/lib/businessDays";

export const SERVICE_NAME = "健診結果の医師意見聴取Web";

// 料金(税込)。件数 = 健診結果の件数(1名1回の健康診断で1件。定期・雇入時・特殊健診を問わない)
export const UNIT_PRICE = 550;
export const MIN_TOTAL = 5500;
export const MIN_SEATS = Math.ceil(MIN_TOTAL / UNIT_PRICE); // 最低料金で付く件数(10件)
export const WEB_MAX_SEATS = 300; // Web申込(カード決済)の上限。超える場合はお見積り
export const PAYMENT_METHODS_TEXT = "クレジットカード";
export const SUPPORT_EMAIL = "support@mestate.jp";
// 産業医面談(医師が必要と判断した方・ご希望の方。オンライン可・意見書込み)
export const INTERVIEW_FEE = 22000;

export type PriceLine = { name: string; unitAmount: number; quantity: number };

// 年度の申込: 件数×単価が最低料金に満たないときは最低料金(最低料金の範囲の件数まで付ける)
export function priceNew(seats: number): { total: number; granted: number; lines: PriceLine[] } {
  const byUnit = seats * UNIT_PRICE;
  if (byUnit >= MIN_TOTAL) {
    return {
      total: byUnit,
      granted: seats,
      lines: [{ name: "健診結果の医師意見聴取(健診結果1件あたり)", unitAmount: UNIT_PRICE, quantity: seats }],
    };
  }
  return {
    total: MIN_TOTAL,
    granted: MIN_SEATS,
    lines: [{ name: `健診結果の医師意見聴取 最低料金(${MIN_SEATS}件分まで)`, unitAmount: MIN_TOTAL, quantity: 1 }],
  };
}

// 件数の追加(最低料金なし)
export function priceAdd(seats: number): { total: number; granted: number; lines: PriceLine[] } {
  return {
    total: seats * UNIT_PRICE,
    granted: seats,
    lines: [{ name: "健診結果の医師意見聴取 件数の追加(1件あたり)", unitAmount: UNIT_PRICE, quantity: seats }],
  };
}

export const taxIncluded = (total: number): number => Math.floor((total * 10) / 110);

// 申し込める年度: 今年度と(2〜3月は)次の年度
export function orderableYears(now: Date = new Date()): number[] {
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  const fy = getFiscalYear(new Date(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()));
  const m = jst.getUTCMonth() + 1;
  return m === 2 || m === 3 ? [fy, fy + 1] : [fy];
}

export const currentFiscalYearJst = (now: Date = new Date()): number => orderableYears(now)[0];

// ---- 入力のそろえ方 ----

const str = (v: unknown, max: number) => (typeof v === "string" ? v.normalize("NFKC").trim().slice(0, max) : "");
const int = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.normalize("NFKC").trim()) : NaN;
  return Number.isInteger(n) ? n : NaN;
};

// 登録番号(T+13桁)または法人番号(13桁)を13桁にそろえる。空なら null、形式が違えば "invalid"
export function normalizeBizId(raw: unknown): string | null | "invalid" {
  const s = typeof raw === "string" ? raw.normalize("NFKC").replace(/[\s\-ー－]/g, "").toUpperCase() : "";
  if (!s) return null;
  const m = /^T?(\d{13})$/.exec(s);
  return m ? m[1] : "invalid";
}

export const officeKey = (name: string): string => name.normalize("NFKC").replace(/\s+/g, "").toLowerCase();

export type SignupInput = {
  companyName: string;
  bizId: string | null;
  officeName: string;
  address: string;
  workers: number;
  workInfo: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  password: string;
};

export function parseSignupInput(raw: Record<string, unknown>): { ok: true; value: SignupInput } | { ok: false; error: string } {
  const biz = normalizeBizId(raw.bizId);
  const v: SignupInput = {
    companyName: str(raw.companyName, 100),
    bizId: biz === "invalid" ? null : biz,
    officeName: str(raw.officeName, 100),
    address: str(raw.address, 200),
    workers: int(raw.workers),
    workInfo: str(raw.workInfo, 2000),
    contactName: str(raw.contactName, 60),
    contactEmail: str(raw.contactEmail, 200).toLowerCase(),
    contactPhone: str(raw.contactPhone, 30),
    password: typeof raw.password === "string" ? raw.password : "",
  };
  if (!v.companyName) return { ok: false, error: "会社名を入力してください" };
  if (biz === "invalid") {
    return { ok: false, error: "登録番号(インボイス)は「T」と数字13桁、法人番号は数字13桁で入力してください" };
  }
  if (!biz && raw.noBizId !== true) {
    return {
      ok: false,
      error: "登録番号(インボイス)または法人番号を入力してください(どちらもお持ちでない場合は「どちらも持っていない」にチェック)",
    };
  }
  if (!v.officeName) return { ok: false, error: "事業場名を入力してください(事業場が1つの場合は「本社」など)" };
  if (!v.address) return { ok: false, error: "事業場の所在地を入力してください" };
  if (!(v.workers >= 1 && v.workers <= 100000)) return { ok: false, error: "事業場の労働者数を入力してください" };
  if (!v.workInfo) return { ok: false, error: "主な業務内容・勤務形態を入力してください(医師が意見を述べるために必要です)" };
  if (!v.contactName) return { ok: false, error: "ご担当者の氏名を入力してください" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.contactEmail)) return { ok: false, error: "メールアドレスを正しく入力してください" };
  if (!/^[0-9+\-() ]{10,}$/.test(v.contactPhone)) return { ok: false, error: "電話番号を正しく入力してください" };
  if (v.password.length < 8) return { ok: false, error: "パスワードは8文字以上で入力してください" };
  if (raw.agreeTerms !== true) return { ok: false, error: "利用規約と個人情報の取扱いへの同意が必要です" };
  return { ok: true, value: v };
}

export type OrderInput = { kind: "new" | "add"; fiscalYear: number; seats: number };

export function parseOrderInput(raw: Record<string, unknown>, now: Date = new Date()): { ok: true; value: OrderInput } | { ok: false; error: string } {
  const kind = raw.kind === "add" ? "add" : raw.kind === "new" ? "new" : null;
  const fiscalYear = int(raw.fiscalYear);
  const seats = int(raw.seats);
  if (!kind) return { ok: false, error: "申込の種類が不正です" };
  if (!orderableYears(now).includes(fiscalYear)) return { ok: false, error: "申し込める年度ではありません" };
  if (!(seats >= 1)) return { ok: false, error: "件数を入力してください" };
  if (seats > WEB_MAX_SEATS) {
    return { ok: false, error: `${WEB_MAX_SEATS}件を超える場合は個別にお見積りします。${SUPPORT_EMAIL} までお問い合わせください` };
  }
  if (raw.agreeTerms !== true) return { ok: false, error: "利用規約への同意が必要です" };
  return { ok: true, value: { kind, fiscalYear, seats } };
}

export const formatYen = (n: number): string => `${n.toLocaleString()}円`;

// ============================================================
// 宣伝ページの文面
// ============================================================

export const HEADLINE = "産業医がいない事業場の、健診結果の「医師の意見聴取」をWebで";
export const SUBHEAD =
  `健康診断の結果を送るだけ。産業医が${IKEN_RETURN_DAYS}営業日以内に就業判定と意見をお返しします。1件${UNIT_PRICE}円(税込)。`;

export const OBLIGATION_POINTS = [
  "事業者は、健康診断で異常の所見があると診断された労働者について、健康を保持するために必要な措置(就業区分など)を医師から聴かなければなりません(労働安全衛生法第66条の4)。",
  "この義務は労働者数にかかわらずすべての事業場にあり、健康診断の実施日から3か月以内に行い、医師の意見を健康診断個人票に記載します(労働安全衛生規則第51条の2)。",
  "50人以上の事業場は選任している産業医に聴きますが、50人未満の事業場には産業医がいないため、医師を自分で探す必要があります。",
];

export const KEY_POINTS = [
  {
    title: `${IKEN_RETURN_DAYS}営業日以内にお返し`,
    text: "健診機関のCSV・PDFをそのまま送るだけ。産業医が判定し、健康管理Webですぐに確認できます。",
  },
  {
    title: `1件${UNIT_PRICE}円(税込)`,
    text: `最低料金${formatYen(MIN_TOTAL)}(${MIN_SEATS}件まで)。年度の途中の雇入時健診なども1件から追加できます。`,
  },
  {
    title: "特殊健診にも対応",
    text: "定期健診・雇入時健診・特定業務従事者健診・特殊健診(有機溶剤・特化物など)まで同じ料金です。",
  },
];

export const DELIVERABLES = [
  "就業区分(通常勤務・就業制限・要休業)と就業上の措置についての医師の意見",
  "就業判定結果の一覧(CSV出力・印刷可)と、健康診断個人票への記載に使える医師の意見",
  "受診が必要な方への受診勧奨通知書(1人1ページ・本人が受診結果を返せるQRコード付き)",
  "要就業制限など、産業医面談が望ましい方の一覧と面談のご案内文書",
  "経年の検査値の比較・有所見者の集計(健康管理Webでいつでも確認)",
];

export const STEPS = [
  { title: "会社を登録(無料)", text: "会社名・事業場・担当者・主な業務内容を入力。確認メールからログインします。" },
  { title: "件数を入れて支払い", text: `その年度の健診結果の件数(人数)を入れて、${PAYMENT_METHODS_TEXT}でお支払い。` },
  { title: "健診結果を送る", text: "健診機関から届いたCSVまたはPDFを、健康管理Webからそのまま送ります。" },
  { title: `${IKEN_RETURN_DAYS}営業日以内に確認`, text: "判定が終わるとメールでお知らせ。健康管理Webで就業判定・医師の意見・受診勧奨通知書を確認できます。" },
];

export const COMPARE_HEAD = ["", "地域産業保健センター(地さんぽ)", "医療機関・健診機関に個別に依頼", "このサービス"];
export const COMPARE_ROWS: string[][] = [
  ["費用", "無料", "機関により異なる", `1件${UNIT_PRICE}円(税込)・最低${formatYen(MIN_TOTAL)}`],
  ["かかる日数", "申込・日程調整のため時間がかかることがある", "機関により異なる", `受付から${IKEN_RETURN_DAYS}営業日以内`],
  ["手続き", "申込書の提出・日程の調整", "見積り・契約が必要な場合も", "Webで登録・支払い。ファイルを送るだけ"],
  ["結果の管理", "紙・個別の記録", "機関により異なる", "健康管理Webで一覧・経年・受診勧奨まで管理"],
];
export const COMPARE_NOTE =
  "地域産業保健センターは国の事業として50人未満の事業場に無料で意見聴取を行っており、時間に余裕がある場合は有力な選択肢です。上の表は一般的な傾向で、地域・機関により異なります。";

export const priceExamples = (): { seats: number; total: number; note: string }[] =>
  [5, 10, 20, 30, 49].map((n) => {
    const p = priceNew(n);
    return { seats: n, total: p.total, note: n < MIN_SEATS ? `最低料金(${MIN_SEATS}件まで)` : `${UNIT_PRICE}円 × ${n}件` };
  });

export const PRICE_NOTES = [
  `健診結果1件(1名1回の健康診断)あたり ${UNIT_PRICE}円・最低料金 ${formatYen(MIN_TOTAL)}(${MIN_SEATS}件まで)。いずれも税込`,
  "件数は年度(4月〜翌3月)ごとです。年度の途中の雇入時健診・特殊健診などは、1件から追加できます",
  `${WEB_MAX_SEATS}件を超える場合はお見積りします`,
  `産業医面談が必要な場合は、ご希望により1回 ${INTERVIEW_FEE.toLocaleString()}円(税込・オンライン可・意見書込み)で承ります`,
  "お申込み後のお客さまのご都合によるキャンセル・返金はお受けできません",
];

export const RETURN_RULES = [
  `返却期限は、健診結果を受け付けた日から${IKEN_RETURN_DAYS}営業日以内です(土日・祝日・年末年始12/29〜1/3を除く)。`,
  "営業日の17時以降・休業日に届いた健診結果は、次の営業日の受付になります。",
  "健診結果が判読できない・業務内容の確認が必要など、お問い合わせが必要な場合は、ご回答をいただいた日から数えます。",
];

export const FAQ: [string, string][] = [
  [
    "異常の所見がない人の分も必要ですか？",
    "法律上の意見聴取の対象は異常の所見があった方ですが、所見の有無の確認も含めて全員分をお送りいただくのがおすすめです(件数は送っていただいた健診結果の件数で数えます)。所見のない方は「通常勤務」と判定します。",
  ],
  [
    "どんなファイルを送ればよいですか？",
    "健診機関から受け取ったCSV(電子データ)またはPDFをそのまま送ってください。紙の場合は、スキャンしたPDFで構いません。",
  ],
  [
    "医師に伝えるべき情報はありますか？",
    "医師が適切な意見を述べるため、事業者は労働者の業務内容・労働時間・深夜業の有無などの情報を提供する必要があります。会社登録時に主な業務内容・勤務形態を入力していただき、個別に伝えたいこと(夜勤のある方・運転業務の方など)は送信時の連絡欄にご記入ください。",
  ],
  [
    "結果はどのように受け取りますか？",
    "判定が終わるとメールでお知らせします(メールには個人の健康情報は書きません)。健康管理Webにログインして、就業判定結果の一覧・医師の意見・受診勧奨通知書を確認・印刷できます。",
  ],
  [
    "就業制限や要休業と判定されたら？",
    "医師の意見を踏まえ、本人の事情も考慮して事業者が就業上の措置を決めます(労働安全衛生法第66条の5)。必要に応じて、当事務所の産業医面談(オンライン可)もご利用いただけます。",
  ],
  [
    "個人情報の取扱いは？",
    "健康診断結果は法令に基づく意見聴取のために利用し、国内(東京)のサーバーに暗号化して保存します。閲覧できるのは貴社の担当者と当事務所に限られ、閲覧の記録も残ります。",
  ],
  [
    "労働者が50人以上になったら？",
    "産業医の選任が必要になります。当事務所の嘱託産業医契約もご案内できます(健康管理Webのデータはそのまま引き継げます)。",
  ],
  ["請求書払いはできますか？", `Web申込のお支払いは${PAYMENT_METHODS_TEXT}です。請求書払いをご希望の場合はお問い合わせください。`],
];
