import { CHECKUP_TYPES, SPECIAL_KINDS, type SpecialKind } from "@/lib/checkups";
import type { BaseCols, ColumnMode } from "@/lib/importRows";

// 1つのファイルに、いくつかの種類の健診(定期健診と特殊健診、有機溶剤と特定化学物質 など)が
// 一緒に入っていても、種類ごとの記録に分けて取り込むための処理。
//   区分(Section) = 健診種別(定期・雇入時・特殊) + 特殊健診の種類

export type Section = { type: string; kind: string | null };
export const sectionKey = (s: Section): string => `${s.type}|${s.kind ?? ""}`;
export const sameSection = (a: Section, b: Section): boolean => sectionKey(a) === sectionKey(b);
export function sectionLabel(s: Section): string {
  const t = CHECKUP_TYPES[s.type] ?? s.type;
  return s.type === "special" ? `${t}（${s.kind || "種類未設定"}）` : t;
}

// 読み取りのときに付く札: 特殊健診の種類のほかに、一般(定期・雇入時)・共通(どの特殊健診にも当たる項目)・不明
export const KIND_GENERAL = "一般";
export const KIND_COMMON = "共通";
export const KIND_UNKNOWN = "不明";
export const KIND_TAGS = [...SPECIAL_KINDS, KIND_GENERAL, KIND_UNKNOWN] as const;
export const COLUMN_KIND_TAGS = [...SPECIAL_KINDS, KIND_GENERAL, KIND_COMMON, KIND_UNKNOWN] as const;

const squash = (s: string | null | undefined) => (s ?? "").normalize("NFKC").replace(/[\s　]/g, "");
const isListed = (k: string): k is SpecialKind => (SPECIAL_KINDS as readonly string[]).includes(k);

// 書き方のゆれをそろえる(「特化物」→ 特定化学物質、「塵肺」→ じん肺 など)。一覧にない書き方は、そのまま返す
export function canonKind(raw: string | null | undefined): string {
  const t = squash(raw);
  if (!t) return "";
  if (isListed(t) || t === KIND_GENERAL || t === KIND_COMMON || t === KIND_UNKNOWN) return t;
  if (/有機/.test(t)) return "有機溶剤";
  if (/特定化学|特化/.test(t)) return "特定化学物質";
  if (/電離|放射線/.test(t)) return "電離放射線";
  if (/じん肺|塵肺|ジン肺/.test(t)) return "じん肺";
  if (/石綿|アスベスト/.test(t)) return "石綿";
  if (/騒音/.test(t)) return "騒音";
  if (/(?<!亜)鉛/.test(t)) return "鉛";
  if (/定期|雇入|一般健/.test(t)) return KIND_GENERAL;
  return (raw ?? "").trim();
}

// 見出し・項目名から、どの特殊健診の項目かを推定する(はっきり分かるものだけ。分からなければ null)
const KIND_HINTS: [SpecialKind, RegExp][] = [
  ["有機溶剤", /有機|溶剤|馬尿酸|マンデル酸|トリクロロ酢酸|総三塩化物|ヘキサンジオン|メチルホルムアミド|フェニルグリオキシル酸/],
  ["特定化学物質", /特定化学|特化物|特化則|特化/],
  ["電離放射線", /電離|放射線|被ばく|被曝|線量|白内障|水晶体/],
  ["じん肺", /じん肺|塵肺|粉じん|エックス線写真の像/],
  ["石綿", /石綿|アスベスト/],
  ["騒音", /騒音|オージオ|250Hz|500Hz|2000Hz|6000Hz|8000Hz/i],
  ["鉛", /(?<!亜)鉛|デルタアミノレブリン酸|δ-?アミノレブリン酸|プロトポルフィリン/],
];
export function kindOfLabel(label: string | null | undefined): SpecialKind | null {
  const t = squash(label);
  if (!t) return null;
  for (const [kind, re] of KIND_HINTS) if (re.test(t)) return kind;
  return null;
}

// 送った方の申告(健診種別・特殊健診の種類)と、読み取りで付いた札から、どの区分として登録するかを決める。
//   "unknown" = 見分けられない(事務所が種類を選ぶ)
// 申告が「特殊健診・種類1つ」のときは申告を信じる。ただし、別の種類とはっきり読めた部分は、その種類に分ける
export function resolveSection(declaredType: string, declared: string[], tag: string | null | undefined): Section | "unknown" {
  const t = canonKind(tag);
  if (declaredType !== "special") {
    if (!t || t === KIND_GENERAL || t === KIND_COMMON) return { type: declaredType, kind: null };
    if (t === KIND_UNKNOWN) return "unknown";
    return { type: "special", kind: t };
  }
  const one = declared.length === 1 ? declared[0] : null;
  if (t === KIND_GENERAL) return { type: "regular", kind: null };
  if (t && t !== KIND_UNKNOWN && t !== KIND_COMMON && t !== "その他") return { type: "special", kind: t };
  if (t === "その他") {
    // 送った方が「その他」に名前(高気圧 など)を書いていれば、その名前で登録する
    const named = declared.filter((k) => !isListed(canonKind(k)));
    return { type: "special", kind: one ?? (named.length === 1 ? named[0] : "その他") };
  }
  return one ? { type: "special", kind: one } : "unknown";
}

// ---- CSV: 列を種類ごとに分ける ----
export type ColumnSplit = {
  // own: その区分だけの列(「共通」の列を除く)。この列に値のある方だけ、その区分の記録を作る
  sections: { section: Section; base: BaseCols; colModes: Record<number, ColumnMode>; own: number[] }[];
  unknown: { base: BaseCols; colModes: Record<number, ColumnMode>; own: number[]; labels: string[] } | null; // 種類を見分けられなかった列
};

// colKinds: 列ごとの札(AIの見分け)。無い列は、見出しから推定する。
// 取り込む列(colModes が off でない列)を、区分ごとの colModes に分ける。
//   「共通」の列(既往歴・業務歴など)は、特殊健診のすべての区分に付ける
//   総合判定の列は、定期健診の区分があればそこに、なければ(区分が1つだけなら)その区分に付ける
export function splitColumns(opts: {
  header: string[];
  base: BaseCols;
  colModes: Record<number, ColumnMode>;
  colKinds: Record<number, string>;
  declaredType: string;
  declared: string[];
}): ColumnSplit {
  const { header, base, colModes, colKinds, declaredType, declared } = opts;
  const groups = new Map<string, { section: Section; cols: number[] }>();
  const common: number[] = [];
  const unknownCols: number[] = [];
  for (const [key, mode] of Object.entries(colModes)) {
    const i = Number(key);
    if (mode.kind === "off") continue;
    const tag = canonKind(colKinds[i]) || kindOfLabel(header[i]) || "";
    if (tag === KIND_COMMON) {
      common.push(i);
      continue;
    }
    // 札のない法定項目(身長・血圧・AST など)は、定期健診・雇入時健診として送られたファイルでは一般の項目とみる。
    // 特殊健診として送られたファイルでは、申告が1種類ならその種類、そうでなければ見分けられないものとして扱う
    // (有機溶剤の肝機能検査のように、特殊健診の項目として同じ検査が入るため)
    const effective = !tag && mode.kind === "legal" && declaredType !== "special" ? KIND_GENERAL : tag;
    const sec = resolveSection(declaredType, declared, effective);
    if (sec === "unknown") {
      unknownCols.push(i);
      continue;
    }
    const g = groups.get(sectionKey(sec)) ?? { section: sec, cols: [] };
    g.cols.push(i);
    groups.set(sectionKey(sec), g);
  }
  const list = Array.from(groups.values()).map((g) => ({ ...g, own: [...g.cols].sort((a, b) => a - b) }));
  // 共通の列: 特殊健診の区分があればそこへ。なければ、最初の区分へ
  const specials = list.filter((g) => g.section.type === "special");
  for (const g of specials.length > 0 ? specials : list.slice(0, 1)) g.cols.push(...common);
  const ownUnknown = [...unknownCols].sort((a, b) => a - b);
  // 区分が1つもないとき(全部見分けられなかった)は、共通の列も、見分けられなかった分に入れる
  if (list.length === 0 && common.length > 0) unknownCols.push(...common);

  const pick = (cols: number[]) => Object.fromEntries(cols.sort((a, b) => a - b).map((i) => [i, colModes[i]])) as Record<number, ColumnMode>;
  const general = list.find((g) => g.section.type !== "special");
  const sections = list.map((g) => ({
    section: g.section,
    // 総合判定の列は1つの区分にだけ付ける(定期健診の総合判定を、特殊健診の記録に付けない)
    base: { ...base, judgmentCol: (general ? g === general : list.length === 1) ? base.judgmentCol : -1 },
    colModes: pick(g.cols),
    own: g.own,
  }));
  const unknown =
    unknownCols.length > 0
      ? {
          // 区分が1つもないときは、総合判定の列も付ける(事務所が種類を選んで、そのまま取り込めるように)
          base: { ...base, judgmentCol: list.length === 0 ? base.judgmentCol : -1 },
          colModes: pick(unknownCols),
          own: ownUnknown.length > 0 ? ownUnknown : [...unknownCols],
          labels: (ownUnknown.length > 0 ? ownUnknown : [...unknownCols].sort((a, b) => a - b)).map((i) => (header[i] ?? "").trim()),
        }
      : null;
  return { sections, unknown };
}

// 見出しの中に、特殊健診の項目とはっきり分かる列があるか(定期健診として送られたCSVに、特殊健診が混ざっていないかの手がかり)
export function hintedKinds(header: string[]): SpecialKind[] {
  const out: SpecialKind[] = [];
  for (const h of header) {
    const k = kindOfLabel(h);
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}
