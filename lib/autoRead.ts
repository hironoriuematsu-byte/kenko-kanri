// 健診結果の自動読み取り(AI)のうち、AIを使わない部分。
//   AIが読んだ内容を、手作業の取込と同じ表の形にそろえる / 2回の読み取りを突き合わせる /
//   ありえない値や、すでに登録されている結果との違いを見つける / 就業判定(事務所の基準)を決める
// 判定そのものは lib/importRows.ts・lib/judgment.ts(手作業の取込と同じ処理)が行う

import { LEGAL_ITEMS, findLegalItemByHeader, parseNumber } from "@/lib/judgment";
import { isRestrictionJudgment, isSevereJudgment, normalizeDate } from "@/lib/checkups";
import { getFiscalYear } from "@/lib/fiscal";
import { referralNote } from "@/lib/referral";
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
};

export const LEGAL_KEYS = LEGAL_ITEMS.map((it) => it.key);
const legalLabel = (key: string) => (LEGAL_ITEMS.find((it) => it.key === key)?.label ?? key).replace(/[（(].*$/, "").trim();
const squash = (s: string | null | undefined) => (s ?? "").normalize("NFKC").replace(/[\s　]/g, "");

// AIが読んだ人ごとの内容を、CSVと同じ「見出し+行」の表にする(以後は手作業の取込と同じ処理で判定する)
export function personsToTable(persons: ReadPerson[]): { header: string[]; rows: string[][]; base: BaseCols; colModes: Record<number, ColumnMode> } {
  const header = ["氏名", "フリガナ", "所属", "社員番号", "性別", "生年月日", "健診日", "総合判定"];
  const base: BaseCols = { nameCol: 0, kanaCol: 1, deptCol: 2, empNoCol: 3, sexCol: 4, birthCol: 5, dateCol: 6, judgmentCol: 7 };
  const colModes: Record<number, ColumnMode> = {};
  const colOf = new Map<string, number>();
  const colId = (it: ReadItem) => `${it.k}|${squash(it.l) || legalLabel(it.k)}`;
  for (const p of persons) {
    for (const it of p.items) {
      if (!LEGAL_KEYS.includes(it.k) || !String(it.v ?? "").trim()) continue;
      const id = colId(it);
      if (colOf.has(id)) continue;
      colOf.set(id, header.length);
      colModes[header.length] = { kind: "legal", itemKey: it.k };
      header.push((it.l ?? "").trim() || legalLabel(it.k));
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

// 値が同じとみなせるか(数値どうしは数として、文字は空白・全角半角の違いを無視して比べる)
export function sameValue(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = squash(a);
  const y = squash(b);
  if (x === y) return true;
  const numeric = /^-?[\d,]+(\.\d+)?$/;
  if (numeric.test(x) && numeric.test(y)) return parseNumber(x) === parseNumber(y);
  const dx = normalizeDate(x);
  return dx != null && dx === normalizeDate(y);
}

function diffPerson(a: ReadPerson, b: ReadPerson): Diff[] {
  const out: Diff[] = [];
  const cmp = (field: string, x: string, y: string) => {
    if (!sameValue(x, y)) out.push({ field, a: x ?? "", b: y ?? "" });
  };
  cmp("氏名", a.name, b.name);
  cmp("生年月日", a.birth, b.birth);
  cmp("性別", a.sex, b.sex);
  cmp("健診日", a.date, b.date);
  const key = (it: ReadItem) => `${it.k}|${squash(it.l)}`;
  const name = (it: ReadItem) => (it.l ?? "").trim() || legalLabel(it.k);
  const bMap = new Map(b.items.filter((it) => LEGAL_KEYS.includes(it.k)).map((it) => [key(it), it]));
  const seen = new Set<string>();
  for (const it of a.items) {
    if (!LEGAL_KEYS.includes(it.k)) continue;
    const k = key(it);
    seen.add(k);
    cmp(name(it), it.v, bMap.get(k)?.v ?? "");
  }
  bMap.forEach((it, k) => {
    if (!seen.has(k) && String(it.v ?? "").trim()) out.push({ field: name(it), a: "", b: it.v });
  });
  return out;
}

// 1回目を基準にして、2回目と食い違うところを人ごとに挙げる。片方にしか出てこない人も挙げる
export function compareReads(a: ReadPerson[], b: ReadPerson[]): { diffs: Diff[][]; onlySecond: ReadPerson[] } {
  const used = new Set<number>();
  const find = (p: ReadPerson): number => {
    const byName = b.findIndex((q, i) => !used.has(i) && squash(q.name) === squash(p.name) && (!p.birth || !q.birth || sameValue(p.birth, q.birth)));
    if (byName >= 0) return byName;
    // 氏名の読みが食い違っていても、同じページ・同じ生年月日なら同じ人として比べる
    return b.findIndex((q, i) => !used.has(i) && q.page === p.page && !!p.birth && sameValue(p.birth, q.birth));
  };
  const diffs = a.map((p) => {
    const i = find(p);
    if (i < 0) return [{ field: "読み取り", a: "1回目だけに出てきました", b: "" }];
    used.add(i);
    return diffPerson(p, b[i]);
  });
  return { diffs, onlySecond: b.filter((_, i) => !used.has(i)) };
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

export function classifyAgainstExisting(row: ImportRow, existing: ExistingCheckup[]): Against {
  const e = findExisting(row, existing);
  if (!e) return { mode: "new" };
  const have = new Map(e.items.map((it) => [squash(it.item_name), it.value ?? ""]));
  const diffs: Diff[] = [];
  const add: ImportItem[] = [];
  for (const it of row.items) {
    const k = squash(it.name);
    if (!have.has(k)) add.push(it);
    else if (!sameValue(have.get(k), it.value ?? "")) diffs.push({ field: it.name, a: have.get(k) ?? "", b: it.value ?? "" });
  }
  if (diffs.length > 0) return { mode: "conflict", existing: e, diffs };
  return add.length > 0 ? { mode: "add", existing: e, items: add } : { mode: "same", existing: e };
}

// ---- 就業判定(事務所があらかじめ決めた基準) ----
//   就業制限の検討水準(R)の項目がある → 判定保留(産業医が確認して確定する)
//   総合判定D(要医療)              → 通常勤務可・受診が条件(医師の意見に受診勧奨の文)
//   それ以外                        → 通常勤務可
//   特殊健診は、自動では判定しない(産業医が判定する)
export type AutoJudgment = { judgment: "normal" | "pending"; condition: "consult" | null; note: string | null };

export function decideWorkJudgment(
  overall: string | null | undefined,
  items: { name: string; value?: string | null; judgment?: string | null }[],
  sex: "male" | "female" | null,
  checkupType: string
): AutoJudgment | null {
  if (checkupType === "special") return null;
  if (items.some((it) => isRestrictionJudgment(it.judgment))) return { judgment: "pending", condition: null, note: null };
  if (isSevereJudgment(overall)) {
    const note = referralNote(items.map((it) => ({ item_name: it.name, judgment: it.judgment ?? null, value: it.value ?? null })), sex);
    return { judgment: "normal", condition: "consult", note: note || null };
  }
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
  judgment: AutoJudgment | null; // 取り込むときに付ける就業判定(null は付けない)
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
}): PlannedPerson[] {
  const seen = new Set<string>();
  return opts.rows.map((row, i) => {
    const sex = row.sex === "male" || row.sex === "female" ? row.sex : null;
    const reasons: string[] = [];
    let diffs: Diff[] = [];
    let diffKind: PlannedPerson["diffKind"] = null;
    const readDiff = opts.readDiffs?.[i] ?? [];
    if (readDiff.length > 0) {
      reasons.push("2回の読み取りで結果が食い違いました");
      diffs = readDiff;
      diffKind = "read";
    }
    if (row.items.length === 0) reasons.push("検査値を読み取れませんでした");
    const odd = implausibleItems(row.items);
    if (odd.length > 0) reasons.push(`ありえない値があります(${odd.join("、")})`);
    if (row.checkup_date && getFiscalYear(new Date(`${row.checkup_date}T00:00:00`)) !== opts.fiscalYear) {
      reasons.push(`健診日(${row.checkup_date})が、指定の年度(${opts.fiscalYear}年度)と違います`);
    }
    // 同じファイルの中に同じ方が2回出てきた
    const who = `${squash(row.target_name)}|${row.birth_date}|${row.employee_no}`;
    if (seen.has(who)) reasons.push("同じファイルの中に、同じ方が2回出てきました");
    seen.add(who);
    if (opts.kind === "pdf" && opts.rosterSize > 0 && !row.person_id) {
      reasons.push("名簿(個人カルテ)の方と結びつきませんでした(氏名の読み違い、または新しい方)");
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
    const base = { row, page: opts.pages?.[i] ?? null, existingId: existing?.id ?? null, diffs, diffKind };

    if (against.mode === "same" && reasons.length === 0) {
      return { ...base, action: "same" as const, addItems: [], reasons, clean: true, judgment: null };
    }
    // 取り込むときに付ける就業判定。すでに医師が判定している方は変えない
    const addItems = against.mode === "add" ? against.items : [];
    const allItems = existing ? [...existing.items.map((it) => ({ name: it.item_name, value: it.value, judgment: it.judgment })), ...addItems] : row.items;
    const mayJudge = !existing || !existing.work_judgment || existing.work_judgment_auto;
    const judgment = mayJudge ? decideWorkJudgment(row.overall_judgment, allItems, sex, opts.checkupType) : null;

    if (reasons.length > 0) return { ...base, action: "hold" as const, addItems, reasons, clean: false, judgment };
    if (opts.kind === "pdf" && !opts.pdfAuto) {
      return { ...base, action: "hold" as const, addItems, reasons: ["PDFから読み取った結果です(内容を確かめてから取り込みます)"], clean: true, judgment };
    }
    return { ...base, action: against.mode === "add" ? ("add" as const) : ("import" as const), addItems, reasons, clean: true, judgment };
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
export type AiMapping = { name: number; kana: number; dept: number; emp_no: number; sex: number; birth: number; date: number; overall: number; items: { col: number; key: string }[] };

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
  for (const it of ai.items ?? []) {
    if (!valid(it.col) || !LEGAL_KEYS.includes(it.key) || usedBase().includes(it.col)) continue;
    const head = header[it.col].normalize("NFKC").trim();
    // 「判定」の列は検査値ではないので、法定項目にしない(手作業の取込と同じ決まり)
    if (/判定/.test(head) || /^判/.test(head)) continue;
    if ((colModes[it.col]?.kind ?? "off") === "off") colModes[it.col] = { kind: "legal", itemKey: it.key };
  }
  return { base, colModes };
}
