// 健診結果の自動読み取り(AI)のうち、AIを使わない部分。
//   AIが読んだ内容を、手作業の取込と同じ表の形にそろえる / 2回の読み取りを突き合わせる /
//   ありえない値や、すでに登録されている結果との違いを見つける / 就業判定(事務所の基準)を決める
// 判定そのものは lib/importRows.ts・lib/judgment.ts(手作業の取込と同じ処理)が行う

import { LEGAL_ITEMS, findLegalItemByHeader, parseNumber, splitBloodPressure } from "@/lib/judgment";
import { isRestrictionJudgment, isSevereJudgment, normalizeDate } from "@/lib/checkups";
import { getFiscalYear } from "@/lib/fiscal";
import { markReferral, needsReferral, referralNote } from "@/lib/referral";
import type { JudgmentRule } from "@/lib/judgment";
import type { BaseCols, ColumnMode, ImportItem, ImportRow } from "@/lib/importRows";

// ---- AIが読んだ内容(PDF) ----
export type ReadItem = { k: string; v: string; l?: string }; // k: 法定項目のキー / l: 用紙に書いてある項目名(2回測定の血圧など)
export type ReadPerson = {
  name: string;
  kana: string;
  birth: string;
  sex: string;
  emp_no: string;
  dept: string;
  date: string;
  overall: string;
  page: number; // PDFのページ(1から)
  items: ReadItem[];
  // どの健診の結果か(特殊健診の種類・一般・不明)。1人に複数の種類があるときは、種類ごとに別の要素になる
  kind?: string;
};

export const LEGAL_KEYS = LEGAL_ITEMS.map((it) => it.key);
// 法定項目の呼び名(説明の括弧を除く)。ただし「AST(GOT)」のように括弧までが名前のものは、そのまま使う
const legalLabel = (key: string) => {
  const label = LEGAL_ITEMS.find((it) => it.key === key)?.label ?? key;
  return label.replace(/（.*$/, "").trim();
};

// ---- どの健診機関の書き方でも、法定項目がそろって並ぶようにする ----

// 見出しの行を探す(表題や発行日の行が先頭にあるCSVに対応)。氏名の見出しがある最初の行
export function findHeaderRow(table: string[][], guessName: (header: string[]) => number): number {
  for (let i = 0; i < Math.min(table.length - 1, 15); i++) {
    if (table[i].filter((c) => (c ?? "").trim() !== "").length >= 3 && guessName(table[i]) >= 0) return i;
  }
  return 0;
}

// 法定項目として取り込む列の見出しを、あとの判定・集計で同じ項目として扱える名前にそろえる。
//   見出しがそのままで法定項目と分かる列(「GOT」「γ-GTP」など)は、健診機関の表記のまま残す。
//   AIが割り当てた、見出しからは分からない列だけを、法定項目の名前(元の見出しを括弧で添える)に変える
export function canonicalHeaders(header: string[], colModes: Record<number, ColumnMode>): { header: string[]; renamed: { from: string; to: string }[] } {
  const out = [...header];
  const renamed: { from: string; to: string }[] = [];
  header.forEach((h, i) => {
    const m = colModes[i];
    if (m?.kind !== "legal" || findLegalItemByHeader(h) === m.itemKey) return;
    const base = legalLabel(m.itemKey);
    const withOriginal = `${base}（${h.trim()}）`;
    let name = h.trim() && findLegalItemByHeader(withOriginal) === m.itemKey ? withOriginal : base;
    for (let n = 2; out.some((x, k) => k !== i && squash(x) === squash(name)); n++) name = `${base} ${n}`;
    out[i] = name;
    renamed.push({ from: h.trim(), to: name });
  });
  return { header: out, renamed };
}

// 定期健診で、ふつうは載っている項目(見当たらないときに知らせる。年齢により省略されることがある)
const EXPECTED: { label: string; any: string[] }[] = [
  { label: "視力", any: ["vision"] },
  { label: "聴力 1000Hz", any: ["hearing1000"] },
  { label: "聴力 4000Hz", any: ["hearing4000"] },
  { label: "血圧", any: ["sbp"] },
  { label: "血色素量", any: ["hb"] },
  { label: "赤血球数", any: ["rbc"] },
  { label: "AST(GOT)", any: ["ast"] },
  { label: "ALT(GPT)", any: ["alt"] },
  { label: "γ-GTP", any: ["ggt"] },
  { label: "中性脂肪", any: ["tg"] },
  { label: "HDLコレステロール", any: ["hdl"] },
  { label: "LDLコレステロール", any: ["ldl"] },
  { label: "血糖(空腹時血糖・随時血糖・HbA1c のいずれか)", any: ["glucose", "casual_glucose", "hba1c"] },
  { label: "尿糖", any: ["urine_glucose"] },
  { label: "尿蛋白", any: ["urine_protein"] },
  { label: "心電図", any: ["ecg"] },
  { label: "胸部エックス線", any: ["chest_xray"] },
];
export type Coverage = {
  found: string[]; // 取り込んだ法定項目
  missing: string[]; // 見当たらなかった項目(定期健診・雇入時健診のみ)
  renamed: { from: string; to: string }[]; // 見出しを法定項目の名前に読み替えた列
};
export function coverageOf(keys: Iterable<string>, checkupType: string, renamed: { from: string; to: string }[] = []): Coverage {
  const have = new Set(keys);
  return {
    found: LEGAL_ITEMS.filter((it) => have.has(it.key)).map((it) => legalLabel(it.key)),
    missing: checkupType === "special" ? [] : EXPECTED.filter((e) => !e.any.some((k) => have.has(k))).map((e) => e.label),
    renamed,
  };
}
// 表の中で、値が1つでも入っている法定項目
export function keysWithData(dataRows: string[][], colModes: Record<number, ColumnMode>): string[] {
  const keys = new Set<string>();
  for (const [i, m] of Object.entries(colModes)) {
    if (m.kind === "legal" && dataRows.some((r) => (r[Number(i)] ?? "").trim() !== "")) keys.add(m.itemKey);
  }
  return Array.from(keys);
}
const squash = (s: string | null | undefined) => (s ?? "").normalize("NFKC").replace(/[\s　]/g, "");

// 特殊健診の項目名から、取り込み方を決める(手作業の取込の既定と同じ考え方。ただし法定項目以外も値として取り込む)
export function specialModeOf(label: string): ColumnMode {
  const head = label.normalize("NFKC").trim();
  if (/分布/.test(head)) return { kind: "distribution" };
  if (head === "判定" || /判定|区分|コード|番号/.test(head)) return { kind: "value" };
  const key = findLegalItemByHeader(label);
  return key ? { kind: "legal", itemKey: key } : { kind: "value" };
}

// 特殊健診のCSV: 見出しから決まらなかった列のうち、検査項目・作業条件・所見などの列を「値として取り込む」にする。
//   aiCols: AIが「特殊健診の項目」と見分けた列。AIが使えないときは、事務的な列(会社名・住所など)以外を取り込む
const ADMIN_HEADER = /会社|事業所|事業場|団体|コース|受診番号|受付|整理番号|カルテ|保険|記号|住所|電話|郵便|〒|請求|料金|金額|備考欄|連絡先|メール|年齢|所属コード|ID$/i;
export function applySpecialColumns(header: string[], dataRows: string[][], cols: { base: BaseCols; colModes: Record<number, ColumnMode> }, aiCols: number[] | null): Record<number, ColumnMode> {
  const colModes = { ...cols.colModes };
  const baseCols = Object.values(cols.base).filter((c) => c >= 0);
  header.forEach((h, i) => {
    const head = h.normalize("NFKC").trim();
    if (!head || baseCols.includes(i) || (colModes[i]?.kind ?? "off") !== "off") return;
    if (!dataRows.some((r) => (r[i] ?? "").trim() !== "")) return;
    if (/判定/.test(head) && head !== "判定") return; // 項目ごとの判定の列は取り込まない(手作業の取込と同じ)
    if (aiCols ? aiCols.includes(i) : !ADMIN_HEADER.test(head)) colModes[i] = { kind: "value" };
  });
  return colModes;
}

// AIが読んだ人ごとの内容を、CSVと同じ「見出し+行」の表にする(以後は手作業の取込と同じ処理で判定する)
export function personsToTable(persons: ReadPerson[]): { header: string[]; rows: string[][]; base: BaseCols; colModes: Record<number, ColumnMode> } {
  const header = ["氏名", "フリガナ", "所属", "社員番号", "性別", "生年月日", "健診日", "総合判定"];
  const base: BaseCols = { nameCol: 0, kanaCol: 1, deptCol: 2, empNoCol: 3, sexCol: 4, birthCol: 5, dateCol: 6, judgmentCol: 7 };
  const colModes: Record<number, ColumnMode> = {};
  const colOf = new Map<string, number>();
  const colId = (it: ReadItem) => `${it.k}|${squash(it.l) || legalLabel(it.k)}`;
  for (const p of persons) {
    for (const it of p.items) {
      if (!String(it.v ?? "").trim()) continue;
      if (!LEGAL_KEYS.includes(it.k)) {
        // 特殊健診の項目(用紙の項目名のまま): 法定項目・分布区分・それ以外(値として取り込む)に振り分ける
        const label = (it.l ?? "").trim();
        if (!label) continue;
        const id = colId(it);
        if (colOf.has(id)) continue;
        colOf.set(id, header.length);
        colModes[header.length] = specialModeOf(label);
        header.push(label);
        continue;
      }
      const id = colId(it);
      if (colOf.has(id)) continue;
      colOf.set(id, header.length);
      colModes[header.length] = { kind: "legal", itemKey: it.k };
      // 用紙の項目名で法定項目と分かればそのまま、分からなければ法定項目の名前にする
      const l = (it.l ?? "").trim();
      header.push(l && findLegalItemByHeader(l) === it.k ? l : l && findLegalItemByHeader(`${legalLabel(it.k)}（${l}）`) === it.k ? `${legalLabel(it.k)}（${l}）` : legalLabel(it.k));
    }
  }
  const rows = persons.map((p) => {
    const r = Array(header.length).fill("");
    r[0] = p.name;
    r[1] = p.kana;
    r[2] = p.dept;
    r[3] = p.emp_no;
    r[4] = p.sex;
    r[5] = p.birth;
    r[6] = p.date;
    r[7] = p.overall;
    for (const it of p.items) {
      const c = colOf.get(colId(it));
      if (c != null && !r[c]) r[c] = String(it.v ?? "").trim();
    }
    return r;
  });
  return { header, rows, base, colModes };
}

// ---- 2回の読み取りの突き合わせ ----
export type Diff = { field: string; a: string; b: string };

// 比べるために、値の書き方をそろえる。
//   マイナスの記号の違い(- − － ‐ など)、尿糖・尿蛋白の括弧の有無((-) と - 、(±) と ± など)は同じとみなす
export function canonValue(v: string | null | undefined): string {
  let x = squash(v).replace(/[‐‑‒–—―−－]/g, "-");
  if (/^\(?[-ー]\)?$/.test(x)) return "-";
  const m = x.match(/^\((.+)\)$/);
  if (m && /^(±|\+-|-\+|\d?\+{1,4})$/.test(m[1])) x = m[1];
  return x;
}

// 値が同じとみなせるか(数値どうしは数として、文字は空白・全角半角・記号の書き方の違いを無視して比べる)
export function sameValue(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = canonValue(a);
  const y = canonValue(b);
  if (x === y) return true;
  const numeric = /^-?[\d,]+(\.\d+)?$/;
  if (numeric.test(x) && numeric.test(y)) return parseNumber(x) === parseNumber(y);
  const dx = normalizeDate(x);
  return dx != null && dx === normalizeDate(y);
}

// 同じ法定項目が複数あるとき(右・左、1回目・2回目、平均、裸眼・矯正)の見分け。
// 項目名の書き方が読み取りごとに違っても(「聴力 右1000Hz」と「右1000Hz」)、同じ項目として比べる
function subKey(label: string | null | undefined): string {
  const n = (label ?? "").normalize("NFKC");
  const t: string[] = [];
  if (/右/.test(n)) t.push("R");
  if (/左/.test(n)) t.push("L");
  const round = n.match(/([1-4])\s*回|第\s*([1-4])|([①②③④])/);
  if (round) t.push(`n${round[1] ?? round[2] ?? "①②③④".indexOf(round[3]) + 1}`);
  if (/平均/.test(n)) t.push("avg");
  if (/矯正/.test(n)) t.push("c");
  if (/裸眼/.test(n)) t.push("n");
  return t.join("");
}

// 人ごとの項目を、比べやすい形(項目の見分け → 値)に直す。
//   「111/62」のように1つの欄に書かれた血圧は、収縮期と拡張期に分けて比べる(分けて書き出した読み取りと同じになる)
type CanonEntry = { key: string; k: string; l: string; name: string; v: string; src: ReadItem; part: "sbp" | "dbp" | null };
const itemName = (it: ReadItem) => (it.l ?? "").trim() || legalLabel(it.k);
const usableItem = (it: ReadItem) => (LEGAL_KEYS.includes(it.k) || !!(it.l ?? "").trim()) && String(it.v ?? "").trim() !== "";
function canonItems(p: ReadPerson): CanonEntry[] {
  const out: CanonEntry[] = [];
  const used = new Set<string>();
  const uniq = (base: string) => {
    let key = base;
    for (let n = 2; used.has(key); n++) key = `${base}#${n}`;
    used.add(key);
    return key;
  };
  const legal = (it: ReadItem) => LEGAL_KEYS.includes(it.k);
  // 分けて書かれた拡張期血圧があるか(あるときは、収縮期の欄の「/」の右側は使わない)
  const hasDbp = (sub: string) => p.items.some((x) => x.k === "dbp" && usableItem(x) && subKey(x.l) === sub);
  for (const it of p.items) {
    if (!usableItem(it)) continue;
    if (!legal(it)) {
      out.push({ key: uniq(`|${squash(it.l)}`), k: it.k, l: (it.l ?? "").trim(), name: itemName(it), v: it.v, src: it, part: null });
      continue;
    }
    const sub = subKey(it.l);
    const bp = it.k === "sbp" || it.k === "dbp" ? splitBloodPressure(String(it.v).normalize("NFKC")) : {};
    if (it.k === "sbp" && bp.sbp != null && bp.dbp != null) {
      out.push({ key: uniq(`sbp|${sub}`), k: "sbp", l: (it.l ?? "").trim(), name: itemName(it), v: String(bp.sbp), src: it, part: "sbp" });
      if (!hasDbp(sub)) out.push({ key: uniq(`dbp|${sub}`), k: "dbp", l: (it.l ?? "").trim(), name: sub ? `拡張期血圧（${(it.l ?? "").trim()}）` : "拡張期血圧", v: String(bp.dbp), src: it, part: "dbp" });
      continue;
    }
    out.push({ key: uniq(`${it.k}|${sub}`), k: it.k, l: (it.l ?? "").trim(), name: itemName(it), v: it.v, src: it, part: null });
  }
  return out;
}

const PERSON_FIELDS = [
  ["氏名", "name"],
  ["生年月日", "birth"],
  ["性別", "sex"],
  ["健診日", "date"],
] as const;

function diffPerson(a: ReadPerson, b: ReadPerson): Diff[] {
  const out: Diff[] = [];
  for (const [field, f] of PERSON_FIELDS) if (!sameValue(a[f], b[f])) out.push({ field, a: a[f] ?? "", b: b[f] ?? "" });
  const ca = canonItems(a);
  const bMap = new Map(canonItems(b).map((e) => [e.key, e]));
  const seen = new Set<string>();
  for (const e of ca) {
    seen.add(e.key);
    const other = bMap.get(e.key)?.v ?? "";
    if (!sameValue(e.v, other)) out.push({ field: e.name, a: e.v, b: other });
  }
  bMap.forEach((e, k) => {
    if (!seen.has(k)) out.push({ field: e.name, a: "", b: e.v });
  });
  return out;
}

// 同じ人か(氏名が同じ。氏名の読みが食い違っていても、同じページ・同じ生年月日なら同じ人として比べる)
// 1人に複数の種類の健診があるときは、同じ種類どうしを比べる
function findSame(p: ReadPerson, list: ReadPerson[], used: Set<number>): number {
  const sameKind = (q: ReadPerson) => (q.kind ?? "") === (p.kind ?? "");
  const byName = list.findIndex((q, i) => !used.has(i) && sameKind(q) && squash(q.name) === squash(p.name) && (!p.birth || !q.birth || sameValue(p.birth, q.birth)));
  if (byName >= 0) return byName;
  return list.findIndex((q, i) => !used.has(i) && sameKind(q) && q.page === p.page && !!p.birth && sameValue(p.birth, q.birth));
}

// 1回目を基準にして、2回目と食い違うところを人ごとに挙げる。片方にしか出てこない人も挙げる
export function compareReads(a: ReadPerson[], b: ReadPerson[]): { diffs: Diff[][]; onlySecond: ReadPerson[] } {
  const used = new Set<number>();
  const diffs = a.map((p) => {
    const i = findSame(p, b, used);
    if (i < 0) return [{ field: "読み取り", a: "1回目だけに出てきました", b: "" }];
    used.add(i);
    return diffPerson(p, b[i]);
  });
  return { diffs, onlySecond: b.filter((_, i) => !used.has(i)) };
}

// 3回の読み取りを突き合わせて、2回以上そろった値を採る(多数決)。
//   2回の読み取りが食い違ったページだけ3回目を読む。3回目を読んでいないページは、c に1回目と同じものを渡す。
//   3回とも違う値・1回しか出てこなかった方だけが、食い違い(確認待ち)として残る
export function reconcileReads(a: ReadPerson[], b: ReadPerson[], c: ReadPerson[]): { reads: ReadPerson[]; diffs: Diff[][] } {
  const usedB = new Set<number>();
  const usedC = new Set<number>();
  const groups: (ReadPerson | null)[][] = [];
  for (const p of a) {
    const i = findSame(p, b, usedB);
    const j = findSame(p, c, usedC);
    if (i >= 0) usedB.add(i);
    if (j >= 0) usedC.add(j);
    groups.push([p, i >= 0 ? b[i] : null, j >= 0 ? c[j] : null]);
  }
  b.forEach((p, i) => {
    if (usedB.has(i)) return;
    const j = findSame(p, c, usedC);
    if (j >= 0) usedC.add(j);
    groups.push([null, p, j >= 0 ? c[j] : null]);
  });
  c.forEach((p, j) => {
    if (!usedC.has(j)) groups.push([null, null, p]);
  });

  const reads: ReadPerson[] = [];
  const diffs: Diff[][] = [];
  for (const g of groups) {
    const present = g.filter((p): p is ReadPerson => p !== null);
    const base = present[0];
    if (present.length === 1) {
      reads.push(base);
      diffs.push([{ field: "読み取り", a: "3回のうち1回だけに出てきました", b: "" }]);
      continue;
    }
    const d: Diff[] = [];
    // 2つ以上そろった値。そろわなければ null
    const majority = (vals: string[]): string | null => {
      for (let i = 0; i < vals.length; i++) for (let j = i + 1; j < vals.length; j++) if (sameValue(vals[i], vals[j])) return vals[i];
      return null;
    };
    const person: ReadPerson = { ...base, items: [] };
    for (const [field, f] of PERSON_FIELDS) {
      const vals = present.map((p) => p[f] ?? "");
      const m = majority(vals);
      if (m != null) person[f] = m;
      else d.push({ field, a: vals[0], b: vals[1] });
    }
    for (const f of ["kana", "emp_no", "dept", "overall"] as const) {
      const vals = present.map((p) => p[f] ?? "");
      person[f] = majority(vals) ?? vals[0];
    }
    const maps = present.map((p) => new Map(canonItems(p).map((e) => [e.key, e])));
    const keys: string[] = [];
    maps.forEach((m) =>
      m.forEach((_, k) => {
        if (!keys.includes(k)) keys.push(k);
      })
    );
    const open = new Set<CanonEntry>(); // そろわなかった項目
    // 採る値を決める(どの読み取りの、どの項目か)
    const chosen: CanonEntry[] = [];
    for (const k of keys) {
      const vals = maps.map((m) => m.get(k)?.v ?? "");
      const m = majority(vals);
      const first = maps.map((mm) => mm.get(k)).find((e): e is CanonEntry => !!e)!;
      if (m == null) {
        d.push({ field: first.name, a: vals[0], b: vals[1] });
        const mine = maps[0].get(k);
        if (mine) {
          chosen.push(mine);
          open.add(mine);
        }
        continue;
      }
      if (m === "") continue; // 2回以上「書かれていない」→ 取り込まない
      chosen.push(maps.map((mm) => mm.get(k)).find((e): e is CanonEntry => !!e && sameValue(e.v, m))!);
    }
    // 1つの欄に書かれた血圧(111/62)は、収縮期・拡張期とも同じ読み取りから採ったときだけ、元の書き方のまま残す
    const done = new Set<ReadItem>();
    for (const e of chosen) {
      if (!e.part) {
        person.items.push(e.src);
        continue;
      }
      if (done.has(e.src)) continue;
      const parts = chosen.filter((x) => x.src === e.src);
      const whole = canonItems({ ...base, items: [e.src] }).length;
      if (parts.length === whole && !parts.some((x) => open.has(x))) {
        done.add(e.src);
        person.items.push(e.src);
      } else {
        person.items.push({ k: e.k, v: e.v, l: e.l || undefined });
      }
    }
    reads.push(person);
    diffs.push(d);
  }
  return { reads, diffs };
}

// ---- ありえない値 ----
const RANGES: Record<string, [number, number]> = {
  sbp: [60, 280],
  dbp: [30, 180],
  ast: [1, 5000],
  alt: [1, 5000],
  ggt: [1, 5000],
  alp: [5, 3000],
  tbil: [0.05, 30],
  tg: [10, 6000],
  hdl: [5, 200],
  ldl: [10, 700],
  glucose: [30, 800],
  casual_glucose: [30, 900],
  hba1c: [3, 18],
  cre: [0.1, 20],
  rbc: [100, 900],
  hb: [3, 25],
};
export function implausibleItems(items: ImportItem[]): string[] {
  const out: string[] = [];
  for (const it of items) {
    const key = findLegalItemByHeader(it.name);
    const range = key ? RANGES[key] : undefined;
    const v = (it.value ?? "").normalize("NFKC").trim();
    if (!range || !/^-?[\d,]+(\.\d+)?$/.test(v)) continue; // 「142/90」などの表記や文字の所見は対象外
    const n = parseNumber(v);
    if (n != null && (n < range[0] || n > range[1])) out.push(`${it.name} ${v}`);
  }
  return out;
}

// ---- すでに登録されている結果との違い ----
export type ExistingCheckup = {
  id: string;
  person_id: string | null;
  employee_no: string | null;
  target_name: string;
  birth_date: string | null;
  sex: string | null;
  work_judgment: string | null;
  work_judgment_auto: boolean;
  checkup_date?: string | null; // 登録済みの結果の健診日(別の回の健診かどうかの見分けに使う)
  items: { item_name: string; value: string | null; judgment: string | null }[];
};
export type Against =
  | { mode: "new" }
  | { mode: "same"; existing: ExistingCheckup }
  | { mode: "add"; existing: ExistingCheckup; items: ImportItem[] }
  | { mode: "conflict"; existing: ExistingCheckup; diffs: Diff[] };

// 同じ方の記録か(取込の決まり hm_import_checkups と同じ: カルテ / 社員番号+氏名 / 生年月日+氏名)
export function findExisting(row: ImportRow, existing: ExistingCheckup[]): ExistingCheckup | null {
  const name = row.target_name.trim();
  return (
    existing.find(
      (e) =>
        (!!row.person_id && e.person_id === row.person_id) ||
        (!!row.employee_no && e.employee_no === row.employee_no && e.target_name === name) ||
        (!!row.birth_date && e.birth_date === row.birth_date && e.target_name === name)
    ) ?? null
  );
}

// 2つの日付が何日離れているか(どちらかが無い・読めないときは null)
export function daysApart(a: string | null | undefined, b: string | null | undefined): number | null {
  const t = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? Date.parse(`${d.slice(0, 10)}T00:00:00Z`) : NaN);
  const x = t(a);
  const y = t(b);
  return Number.isNaN(x) || Number.isNaN(y) ? null : Math.round(Math.abs(x - y) / 86_400_000);
}
// 登録済みの結果と健診日がこれ以上離れていたら、別の回の健診とみる(年2回の健診は約6か月おき。再検査や受け直しは通常2か月以内)
export const OTHER_ROUND_DAYS = 60;

export function classifyAgainstExisting(row: ImportRow, existing: ExistingCheckup[]): Against {
  const e = findExisting(row, existing);
  if (!e) return { mode: "new" };
  // 同じ検査項目か。健診機関ごとに項目名の書き方が違っても、同じ法定項目なら同じとみなす。
  // 血圧の1回目・2回目、視力・聴力の右・左のように、同じ法定項目が複数あるときだけ、項目名で区別する
  const keyOf = (name: string) => findLegalItemByHeader(name);
  const countBy = (names: string[]) => {
    const m = new Map<string, number>();
    for (const n of names) {
      const k = keyOf(n);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const oldCount = countBy(e.items.map((it) => it.item_name));
  const newCount = countBy(row.items.map((it) => it.name));
  const itemId = (name: string) => {
    const key = keyOf(name);
    return key && (oldCount.get(key) ?? 0) <= 1 && (newCount.get(key) ?? 0) <= 1 ? `k:${key}` : squash(name);
  };
  const have = new Map(e.items.map((it) => [itemId(it.item_name), it.value ?? ""]));
  const diffs: Diff[] = [];
  const add: ImportItem[] = [];
  for (const it of row.items) {
    const k = itemId(it.name);
    if (!have.has(k)) add.push(it);
    else if (!sameValue(have.get(k), it.value ?? "")) diffs.push({ field: it.name, a: have.get(k) ?? "", b: it.value ?? "" });
  }
  if (diffs.length > 0) return { mode: "conflict", existing: e, diffs };
  return add.length > 0 ? { mode: "add", existing: e, items: add } : { mode: "same", existing: e };
}

// ---- 就業判定(事務所があらかじめ決めた基準) ----
//   就業制限の検討水準(R)の項目がある            → 判定保留(産業医が確認して確定する)
//   総合判定D(要医療)で、受診勧奨の基準に届く    → 通常勤務可・受診が条件(医師の意見に受診勧奨の文)
//   総合判定D(要医療)だが、受診勧奨の基準には届かない → 通常勤務可(条件なし)
//   それ以外                                      → 通常勤務可
//   特殊健診は、自動では判定しない(産業医が判定する)
// 受診勧奨の基準は、要医療(D)の基準より緩い事務所の基準(lib/referral.ts。例: γ-GTP は 201 以上)
export type AutoJudgment = { judgment: "normal" | "pending"; condition: "consult" | null; note: string | null };

type JItem = { name: string; value?: string | null; judgment?: string | null };
const marked = (items: JItem[], sex: "male" | "female" | null, rules: JudgmentRule[]) =>
  markReferral(items.map((it) => ({ item_name: it.name, judgment: it.judgment ?? null, value: it.value ?? null })), sex, rules);

// その方が受診勧奨の対象か(事後措置を「受診勧奨」にするか)
export function needsFollowup(overall: string | null | undefined, items: JItem[], sex: "male" | "female" | null, rules: JudgmentRule[]): boolean {
  return needsReferral(overall, marked(items, sex, rules));
}

export function decideWorkJudgment(overall: string | null | undefined, items: JItem[], sex: "male" | "female" | null, checkupType: string, rules: JudgmentRule[] = []): AutoJudgment | null {
  if (checkupType === "special") return null;
  if (items.some((it) => isRestrictionJudgment(it.judgment))) return { judgment: "pending", condition: null, note: null };
  const m = marked(items, sex, rules);
  if (needsReferral(overall, m)) return { judgment: "normal", condition: "consult", note: referralNote(m, sex) || null };
  return { judgment: "normal", condition: null, note: null };
}

// ---- 一人ずつの扱いを決める ----
export type PlannedPerson = {
  row: ImportRow;
  page: number | null;
  action: "import" | "add" | "same" | "hold";
  existingId: string | null;
  addItems: ImportItem[]; // action=add のとき、足す項目
  reasons: string[]; // 確認待ちにした理由
  diffs: Diff[]; // 食い違い(2回の読み取り / すでに登録されている結果)
  diffKind: "read" | "existing" | null;
  clean: boolean; // 確認待ちだが、問題は見つかっていない(PDFの確認運用のため)
  otherRound: boolean; // このファイルは、別の回(2回目など)の健診とみられる
  cautions: string[]; // 止めずに取り込んだが、知らせておくこと
  judgment: AutoJudgment | null; // 取り込むときに付ける就業判定(null は付けない)
  needsFollowup: boolean; // 受診勧奨の対象か
};

export function planPeople(opts: {
  rows: ImportRow[];
  pages?: (number | null)[];
  readDiffs?: Diff[][]; // PDFの2回読みの食い違い(rows と同じ並び)
  existing: ExistingCheckup[];
  checkupType: string;
  fiscalYear: number;
  kind: "csv" | "pdf";
  rosterSize: number; // 個人カルテ(名簿)の人数
  pdfAuto: boolean; // PDFも、問題のない方は確認なしで取り込む
  rules?: JudgmentRule[]; // 判定基準(受診勧奨の基準 S を含む)
  roster?: { full_name: string; birth_date: string | null }[]; // 個人カルテ(名簿)。氏名の読み違いの見分けに使う
}): PlannedPerson[] {
  const rules = opts.rules ?? [];
  const seen = new Set<string>();
  // 別の回(2回目など)の健診を、同じ回として送っていないか。
  // すでに登録されている結果と健診日が大きく離れている方が何人もいれば、ファイル全体を止めて事務所が確かめる
  // (止めないと、1回目に結果のない方だけが、違う回に取り込まれてしまう)
  const far = opts.rows.map((row) => {
    const e = findExisting(row, opts.existing);
    const gap = e ? daysApart(row.checkup_date, e.checkup_date) : null;
    return { matched: Boolean(e), date: e?.checkup_date ?? null, far: gap != null && gap >= OTHER_ROUND_DAYS };
  });
  const farCount = far.filter((f) => f.far).length;
  const matchedCount = far.filter((f) => f.matched).length;
  const otherRound = farCount >= 2 || (farCount >= 1 && farCount * 2 >= matchedCount);
  // 健診日が指定の年度から外れている方。ファイルの半分以上が年度内で、外れが半年以内なら、止めずに取り込んで知らせる
  // (年度の変わり目に受けた方など)。ファイルの大半が年度外なら、年度の指定違いとみて止める
  const fyStart = `${opts.fiscalYear}-04-01`;
  const fyEnd = `${opts.fiscalYear + 1}-03-31`;
  const outside = (d: string | null) => (!d ? null : d < fyStart ? daysApart(d, fyStart) : d > fyEnd ? daysApart(d, fyEnd) : 0);
  const dated = opts.rows.map((r) => outside(r.checkup_date)).filter((n): n is number => n != null);
  const mostlyInYear = dated.filter((n) => n === 0).length * 2 >= dated.length;
  return opts.rows.map((row, i) => {
    const sex = row.sex === "male" || row.sex === "female" ? row.sex : null;
    const reasons: string[] = [];
    const cautions: string[] = [];
    let diffs: Diff[] = [];
    let diffKind: PlannedPerson["diffKind"] = null;
    const readDiff = opts.readDiffs?.[i] ?? [];
    if (readDiff.length > 0) {
      reasons.push("読み取りをくり返しても、結果がそろいませんでした");
      diffs = readDiff;
      diffKind = "read";
    }
    if (row.items.length === 0) reasons.push("検査値を読み取れませんでした");
    const odd = implausibleItems(row.items);
    if (odd.length > 0) reasons.push(`ありえない値があります(${odd.join("、")})`);
    if (row.checkup_date && getFiscalYear(new Date(`${row.checkup_date}T00:00:00`)) !== opts.fiscalYear) {
      const off = outside(row.checkup_date);
      if (mostlyInYear && off != null && off <= 183) cautions.push(`健診日(${row.checkup_date})が、指定の年度(${opts.fiscalYear}年度)の外です。${opts.fiscalYear}年度の結果として取り込みました`);
      else reasons.push(`健診日(${row.checkup_date})が、指定の年度(${opts.fiscalYear}年度)と違います`);
    }
    // 同じファイルの中に同じ方が2回出てきた
    const who = `${squash(row.target_name)}|${row.birth_date}|${row.employee_no}`;
    if (seen.has(who)) reasons.push("同じファイルの中に、同じ方が2回出てきました");
    seen.add(who);
    if (opts.kind === "pdf" && opts.rosterSize > 0 && !row.person_id) {
      // 名簿に、同じ生年月日で氏名の違う方がいるときだけ、氏名の読み違いとみて止める。いなければ新しい方として取り込む(CSVと同じ)
      const near = row.birth_date ? (opts.roster ?? []).find((r) => r.birth_date === row.birth_date && squash(r.full_name) !== squash(row.target_name)) : undefined;
      if (near) reasons.push(`名簿(個人カルテ)に、同じ生年月日の ${near.full_name} さんがいます。氏名の読み違いかもしれません`);
      else if (!opts.roster) reasons.push("名簿(個人カルテ)の方と結びつきませんでした(氏名の読み違い、または新しい方)");
      else cautions.push("名簿(個人カルテ)にいない方です。新しい方として取り込みました");
    }
    if (far[i].far) {
      reasons.push(`すでに登録されている結果(健診日 ${far[i].date})と、健診日(${row.checkup_date})が離れています。別の回(2回目など)の健診のようです`);
    } else if (otherRound) {
      reasons.push("同じファイルに、別の回(2回目など)の健診とみられる方がいるため、取り込みを止めています");
    }

    const against = classifyAgainstExisting(row, opts.existing);
    if (against.mode === "conflict" && diffKind == null) {
      reasons.push("すでに登録されている結果と、値が違います");
      diffs = against.diffs;
      diffKind = "existing";
    } else if (against.mode === "conflict") {
      reasons.push("すでに登録されている結果と、値が違います");
    }
    const existing = against.mode === "new" ? null : against.existing;
    const base = { row, page: opts.pages?.[i] ?? null, existingId: existing?.id ?? null, diffs, diffKind, otherRound, cautions };

    if (against.mode === "same" && reasons.length === 0) {
      return { ...base, action: "same" as const, addItems: [], reasons, clean: true, judgment: null, needsFollowup: false };
    }
    // 取り込むときに付ける就業判定。すでに医師が判定している方は変えない
    const addItems = against.mode === "add" ? against.items : [];
    const allItems = existing ? [...existing.items.map((it) => ({ name: it.item_name, value: it.value, judgment: it.judgment })), ...addItems] : row.items;
    const mayJudge = !existing || !existing.work_judgment || existing.work_judgment_auto;
    const judgment = mayJudge ? decideWorkJudgment(row.overall_judgment, allItems, sex, opts.checkupType, rules) : null;
    const rest = { addItems, judgment, needsFollowup: needsFollowup(row.overall_judgment, allItems, sex, rules) };

    if (reasons.length > 0) return { ...base, ...rest, action: "hold" as const, reasons, clean: false };
    if (opts.kind === "pdf" && !opts.pdfAuto) {
      return { ...base, ...rest, action: "hold" as const, reasons: ["PDFから読み取った結果です(内容を確かめてから取り込みます)"], clean: true };
    }
    return { ...base, ...rest, action: against.mode === "add" ? ("add" as const) : ("import" as const), reasons, clean: true };
  });
}

// 結果の要約(会社・事務所の画面に出す)
export type ReadSummary = {
  total: number;
  imported: number; // 新しく取り込んだ
  added: number; // すでにある記録に項目を足した
  same: number; // 登録済みで変更なし
  held: number; // 確認待ち
  normal: number; // 通常勤務可
  consult: number; // 通常勤務可・受診が条件
  pending: number; // 判定保留(産業医が確認中)
  unjudged: number; // 就業判定は産業医が行う(特殊健診など)
};
export function summarize(people: PlannedPerson[]): ReadSummary {
  const done = people.filter((p) => p.action === "import" || p.action === "add");
  return {
    total: people.length,
    imported: people.filter((p) => p.action === "import").length,
    added: people.filter((p) => p.action === "add").length,
    same: people.filter((p) => p.action === "same").length,
    held: people.filter((p) => p.action === "hold").length,
    normal: done.filter((p) => p.judgment?.judgment === "normal" && !p.judgment.condition).length,
    consult: done.filter((p) => p.judgment?.judgment === "normal" && p.judgment.condition === "consult").length,
    pending: done.filter((p) => p.judgment?.judgment === "pending").length,
    unjudged: done.filter((p) => !p.judgment).length,
  };
}

// ---- CSV: AIによる列の割り当ての補助 ----
//   見出しから自動で決まらなかった列だけを、AIの答えで補う(自動で決まった列は変えない)
export type AiMapping = { name: number; kana: number; dept: number; emp_no: number; sex: number; birth: number; date: number; overall: number; items: { col: number; key: string }[]; special?: number[]; kinds?: { col: number; kind: string }[] };

export function applyAiMapping(header: string[], guess: { base: BaseCols; colModes: Record<number, ColumnMode> }, ai: AiMapping): { base: BaseCols; colModes: Record<number, ColumnMode> } {
  const base = { ...guess.base };
  const colModes = { ...guess.colModes };
  const valid = (c: unknown): c is number => typeof c === "number" && Number.isInteger(c) && c >= 0 && c < header.length;
  const usedBase = () => Object.values(base).filter((c) => c >= 0);
  const fill = (k: keyof BaseCols, c: number) => {
    if (base[k] < 0 && valid(c) && !usedBase().includes(c)) base[k] = c;
  };
  fill("nameCol", ai.name);
  fill("kanaCol", ai.kana);
  fill("deptCol", ai.dept);
  fill("empNoCol", ai.emp_no);
  fill("sexCol", ai.sex);
  fill("birthCol", ai.birth);
  fill("dateCol", ai.date);
  fill("judgmentCol", ai.overall);
  // 見出しから決まった法定項目は、AIの答えで別の列を足さない(non-HDL を HDL に、のような取り違えを防ぐ)。
  // 血圧・視力・聴力は、2回測定や右・左で複数の列があるので足してよい
  const multi = ["sbp", "dbp", "vision", "hearing1000", "hearing4000"];
  const decided = new Set(Object.values(guess.colModes).flatMap((m) => (m.kind === "legal" ? [m.itemKey] : [])));
  for (const it of ai.items ?? []) {
    if (!valid(it.col) || !LEGAL_KEYS.includes(it.key) || usedBase().includes(it.col)) continue;
    if (decided.has(it.key) && !multi.includes(it.key)) continue;
    const head = header[it.col].normalize("NFKC").trim();
    // 「判定」の列は検査値ではないので、法定項目にしない(手作業の取込と同じ決まり)
    if (/判定/.test(head) || /^判/.test(head)) continue;
    if ((colModes[it.col]?.kind ?? "off") === "off") colModes[it.col] = { kind: "legal", itemKey: it.key };
  }
  return { base, colModes };
}
