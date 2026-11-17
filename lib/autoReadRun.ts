import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCsv } from "@/lib/checkups";
import { buildImportRows, guessColumns, type ImportItem, type ImportRow } from "@/lib/importRows";
import type { JudgmentRule } from "@/lib/judgment";
import type { PersonCandidate } from "@/lib/personMatch";
import {
  applyAiMapping,
  canonicalHeaders,
  coverageOf,
  findHeaderRow,
  keysWithData,
  classifyAgainstExisting,
  compareReads,
  decideWorkJudgment,
  needsFollowup,
  personsToTable,
  planPeople,
  summarize,
  type AutoJudgment,
  type Coverage,
  type Diff,
  type ExistingCheckup,
  type PlannedPerson,
  type ReadPerson,
  type ReadSummary,
} from "@/lib/autoRead";
import { PDF_PAGES_PER_CHUNK, aiReady, mapCsvColumns, pdfPageCount, pdfSlice, readPdfPart } from "@/lib/autoReadServer";

// 健診結果の自動読み取りの進行(サーバー側)。
//   CSV: 1回の呼び出しで、列の割り当て → 判定 → 取込 → 就業判定 まで行う
//   PDF: 数ページずつ読み(1回の呼び出しで1区切り)、全部読み終えたら取込まで行う。画面から続けて呼ぶ

export type Actor = { id: string; role: "office" | "company"; companyId: string | null };

export type Upload = {
  id: string;
  company_id: string;
  file_name: string;
  kind: string | null;
  content: string | null;
  storage_path: string | null;
  fiscal_year: number | null;
  checkup_type: string | null;
  round: number | null;
  special_kind: string | null;
  status: string;
  file_hash: string | null;
  read_status: string;
  read_work: Work | null;
  read_result: ReadResult | null;
  read_error: string | null;
  read_updated_at: string | null;
  created_at: string;
};

type Chunk = { from: number; to: number; done: boolean; a?: ReadPerson[]; b?: ReadPerson[] };
type Work = { pages: number; chunks: Chunk[] };

// 画面に出す・あとで承認するために残す、一人ずつの結果
export type StoredPerson = {
  name: string;
  birth: string;
  page: number | null;
  status: "imported" | "added" | "same" | "hold" | "skipped";
  reasons: string[];
  clean: boolean;
  diffs: Diff[];
  diffKind: "read" | "existing" | null;
  judgment: AutoJudgment | null;
  overall: string;
  // 確認待ちの方だけ: 承認のときに使う
  row?: ImportRow;
  read?: ReadPerson; // PDFから読んだ内容(食い違いのどちらを採るか選べるように)
};
export type ReadResult = { kind: "csv" | "pdf"; summary: ReadSummary; people: StoredPerson[]; at: string; coverage?: Coverage };

export type RunState = {
  status: string; // none / reading / review / done / failed
  progress: { done: number; total: number } | null;
  result: ReadResult | null;
  error: string | null;
  busy?: boolean;
};

const UPLOAD_COLS =
  "id, company_id, file_name, kind, content, storage_path, fiscal_year, checkup_type, round, special_kind, status, file_hash, read_status, read_work, read_result, read_error, read_updated_at, created_at";

export async function loadUpload(admin: SupabaseClient, id: string): Promise<Upload | null> {
  const { data } = await admin.from("hm_csv_uploads").select(UPLOAD_COLS).eq("id", id).maybeSingle();
  return (data as Upload | null) ?? null;
}

export const stateOf = (u: Upload): RunState => ({
  status: u.read_status,
  progress: u.read_work ? { done: u.read_work.chunks.filter((c) => c.done).length, total: u.read_work.chunks.length } : null,
  result: u.read_result,
  error: u.read_error,
});

export const sha256 = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");

async function downloadPdf(admin: SupabaseClient, path: string): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from("hm-files").download(path);
  if (error || !data) throw new Error("PDFを開けませんでした");
  return new Uint8Array(await data.arrayBuffer());
}

async function fail(admin: SupabaseClient, u: Upload, message: string): Promise<RunState> {
  await admin.from("hm_csv_uploads").update({ read_status: "failed", read_error: message, read_updated_at: null }).eq("id", u.id);
  return { status: "failed", progress: null, result: null, error: message };
}

export async function pdfAutoSetting(admin: SupabaseClient): Promise<boolean> {
  const { data } = await admin.from("hm_settings").select("value").eq("key", "pdf_auto").maybeSingle();
  return data?.value === true;
}

// 判定基準・名簿・すでに登録されている結果を読む
async function loadContext(admin: SupabaseClient, u: Upload) {
  const round = Math.max(1, Math.min(4, u.round ?? 1));
  const kind = u.checkup_type === "special" ? (u.special_kind ?? "").trim() : "";
  const [{ data: rules }, { data: persons }, { data: checkups }, pdfAuto] = await Promise.all([
    admin.from("hm_judgment_rules").select("id, item_key, item_label, unit, sex, grade, min_value, max_value, match_text, sort_order").order("item_key").order("sort_order"),
    admin.from("hm_persons").select("id, full_name, employee_no, birth_date, user_id").eq("company_id", u.company_id),
    admin
      .from("hm_checkups")
      .select("id, person_id, employee_no, target_name, birth_date, sex, special_kind, work_judgment, work_judgment_auto")
      .eq("company_id", u.company_id)
      .eq("fiscal_year", u.fiscal_year!)
      .eq("round", round)
      .eq("checkup_type", u.checkup_type!),
    pdfAutoSetting(admin),
  ]);
  const same = ((checkups ?? []) as (Omit<ExistingCheckup, "items"> & { special_kind: string | null })[]).filter((c) => (c.special_kind ?? "").trim() === kind);
  const items: { checkup_id: string; item_name: string; value: string | null; judgment: string | null }[] = [];
  const ids = same.map((c) => c.id);
  for (let i = 0; i < ids.length; i += 100) {
    for (let from = 0; ; from += 1000) {
      const { data } = await admin
        .from("hm_checkup_items")
        .select("checkup_id, item_name, value, judgment")
        .in("checkup_id", ids.slice(i, i + 100))
        .order("id")
        .range(from, from + 999);
      items.push(...((data as typeof items | null) ?? []));
      if (!data || data.length < 1000) break;
    }
  }
  const existing: ExistingCheckup[] = same.map((c) => ({ ...c, work_judgment_auto: Boolean(c.work_judgment_auto), items: items.filter((it) => it.checkup_id === c.id) }));
  return { rules: (rules ?? []) as JudgmentRule[], persons: (persons ?? []) as PersonCandidate[], existing, pdfAuto };
}

const toStored = (p: PlannedPerson, read?: ReadPerson): StoredPerson => ({
  name: p.row.target_name,
  birth: p.row.birth_date,
  page: p.page,
  status: p.action === "import" ? "imported" : p.action === "add" ? "added" : p.action,
  reasons: p.reasons,
  clean: p.clean,
  diffs: p.diffs,
  diffKind: p.diffKind,
  judgment: p.judgment,
  overall: p.row.overall_judgment,
  ...(p.action === "hold" ? { row: p.row, read } : {}),
});

// 取込に渡す形
const toApply = (row: ImportRow, mode: "new" | "add", existingId: string | null, items: ImportItem[], wj: AutoJudgment | null, page: number | null, follow: boolean) => ({
  mode,
  existing_id: existingId,
  page,
  row,
  items,
  wj,
  needs_followup: follow, // 受診勧奨の対象か(事務所の基準)
});

async function apply(admin: SupabaseClient, u: Upload, actor: Actor, people: ReturnType<typeof toApply>[], result: ReadResult): Promise<RunState> {
  const status = result.people.some((p) => p.status === "hold") ? "review" : "done";
  const { error } = await admin.rpc("hm_auto_apply", {
    p_upload_id: u.id,
    p_actor: actor.id,
    p_actor_role: actor.role,
    p_people: people,
    p_read_status: status,
    p_read_result: result,
  });
  if (error) return fail(admin, u, `取り込めませんでした: ${error.message}`);
  return { status, progress: null, result, error: null };
}

// 読み取った行から、一人ずつの扱いを決めて取り込む
async function finalize(admin: SupabaseClient, u: Upload, actor: Actor, kind: "csv" | "pdf", rows: ImportRow[], ctx: Awaited<ReturnType<typeof loadContext>>, coverage: Coverage, extra?: { reads: ReadPerson[]; readDiffs: Diff[][] }): Promise<RunState> {
  const plan = planPeople({
    rows,
    pages: extra?.reads.map((r) => r.page),
    readDiffs: extra?.readDiffs,
    existing: ctx.existing,
    checkupType: u.checkup_type!,
    fiscalYear: u.fiscal_year!,
    kind,
    rosterSize: ctx.persons.length,
    pdfAuto: ctx.pdfAuto,
    rules: ctx.rules,
  });
  const people = plan
    .filter((p) => p.action === "import" || p.action === "add")
    .map((p) => toApply(p.row, p.action === "add" ? "add" : "new", p.existingId, p.action === "add" ? p.addItems : p.row.items, p.judgment, p.page, p.needsFollowup));
  const result: ReadResult = { kind, summary: summarize(plan), people: plan.map((p, i) => toStored(p, extra?.reads[i])), at: new Date().toISOString(), coverage };
  return apply(admin, u, actor, people, result);
}

const tableRows = (reads: ReadPerson[], ctx: Awaited<ReturnType<typeof loadContext>>, checkupType: string): ImportRow[] => {
  const t = personsToTable(reads);
  return buildImportRows({ header: t.header, dataRows: t.rows, base: t.base, colModes: t.colModes, autoJudge: true, rules: ctx.rules, checkupType, commonDate: "", persons: ctx.persons });
};

async function runCsv(admin: SupabaseClient, u: Upload, actor: Actor): Promise<RunState> {
  if (!u.content) return fail(admin, u, "CSVの中身が残っていません(破棄されたファイルです)");
  const table = parseCsv(u.content);
  if (table.length < 2) return fail(admin, u, "データ行がありません(1行目に見出し、2行目以降にデータ)");
  // 表題などの行が先頭にあるCSVでは、氏名の見出しがある行を見出しとして使う
  const headerRow = findHeaderRow(table, (h) => guessColumns(h).base.nameCol);
  let header = table[headerRow];
  const dataRows = table.slice(headerRow + 1).filter((r) => r.some((c) => (c ?? "").trim() !== ""));
  const ctx = await loadContext(admin, u);
  if (!ctx.rules.some((r) => r.grade !== "S")) return fail(admin, u, "判定基準が未登録のため、自動では判定できません");
  let cols = guessColumns(header);
  // 見出しから決まらなかった列があれば、AIに見出しと値の例を見せて、法定項目に当たる列を見分けてもらう
  // (氏名の列の中身は送らない)。健診機関ごとの書き方の違いを、ここで吸収する
  const baseCols = Object.values(cols.base).filter((c) => c >= 0);
  const undecided = header.some((h, i) => h.trim() !== "" && !baseCols.includes(i) && (cols.colModes[i]?.kind ?? "off") === "off" && !/判定/.test(h.normalize("NFKC")) && dataRows.some((r) => (r[i] ?? "").trim() !== ""));
  const gaps = cols.base.nameCol < 0 || cols.base.dateCol < 0 || cols.base.birthCol < 0 || cols.base.sexCol < 0;
  if ((gaps || undecided) && aiReady()) {
    try {
      const ai = await mapCsvColumns(header, dataRows.slice(0, 3), [cols.base.nameCol, cols.base.kanaCol].filter((c) => c >= 0));
      cols = applyAiMapping(header, cols, ai);
    } catch (e) {
      console.error("csv mapping by AI failed", e);
    }
  }
  if (cols.base.nameCol < 0) return fail(admin, u, "氏名の列が見つかりませんでした。手作業の取込(列を指定する画面)をお使いください");
  if (!Object.values(cols.colModes).some((m) => m.kind === "legal")) return fail(admin, u, "検査項目の列が見つかりませんでした。手作業の取込(列を指定する画面)をお使いください");
  // AIが見分けた列は、あとの判定・集計で同じ法定項目として扱える名前にそろえる
  const canon = canonicalHeaders(header, cols.colModes);
  header = canon.header;
  const rows = buildImportRows({ header, dataRows, base: cols.base, colModes: cols.colModes, autoJudge: true, rules: ctx.rules, checkupType: u.checkup_type!, commonDate: "", persons: ctx.persons });
  if (rows.length === 0) return fail(admin, u, "氏名のある行がありませんでした");
  const coverage = coverageOf(keysWithData(dataRows, cols.colModes), u.checkup_type!, canon.renamed);
  return finalize(admin, u, actor, "csv", rows, ctx, coverage);
}

async function runPdf(admin: SupabaseClient, u: Upload, actor: Actor): Promise<RunState> {
  if (!aiReady()) return fail(admin, u, "AIの読み取りは準備中です(設定が済むと使えるようになります)");
  if (!u.storage_path) return fail(admin, u, "PDFが残っていません");
  const bytes = await downloadPdf(admin, u.storage_path);
  let work = u.read_work;
  if (!work) {
    let pages: number;
    try {
      pages = await pdfPageCount(bytes);
    } catch {
      return fail(admin, u, "PDFを開けませんでした(パスワード付き、または壊れたファイルの可能性があります)");
    }
    if (pages === 0) return fail(admin, u, "PDFにページがありません");
    const chunks: Chunk[] = [];
    for (let from = 1; from <= pages; from += PDF_PAGES_PER_CHUNK) chunks.push({ from, to: Math.min(pages, from + PDF_PAGES_PER_CHUNK - 1), done: false });
    work = { pages, chunks };
    await admin.from("hm_csv_uploads").update({ read_work: work, read_status: "reading", file_hash: u.file_hash ?? sha256(bytes), read_updated_at: null }).eq("id", u.id);
    return { status: "reading", progress: { done: 0, total: chunks.length }, result: null, error: null };
  }

  const i = work.chunks.findIndex((c) => !c.done);
  if (i >= 0) {
    const c = work.chunks[i];
    const part = await pdfSlice(bytes, c.from, c.to);
    // 同じページを2回読ませて、あとで突き合わせる
    const [a, b] = await Promise.all([readPdfPart(part, c.from - 1), readPdfPart(part, c.from - 1)]);
    if (a.truncated || b.truncated) {
      // 1ページに人数が多くて書き出しきれなかった: 1ページずつに分けて読み直す
      if (c.to === c.from) return fail(admin, u, `${c.from}ページ目に載っている人数が多く、読み取りきれませんでした。手作業の取込をお使いください`);
      const singles: Chunk[] = Array.from({ length: c.to - c.from + 1 }, (_, k) => ({ from: c.from + k, to: c.from + k, done: false }));
      work.chunks.splice(i, 1, ...singles);
    } else {
      work.chunks[i] = { ...c, done: true, a: a.persons, b: b.persons };
    }
    await admin.from("hm_csv_uploads").update({ read_work: work, read_updated_at: null }).eq("id", u.id);
    if (work.chunks.some((x) => !x.done)) {
      return { status: "reading", progress: { done: work.chunks.filter((x) => x.done).length, total: work.chunks.length }, result: null, error: null };
    }
  }

  // 全部読み終えた: 2回の読み取りを突き合わせて、判定・取込へ
  const A = mergePeople(work.chunks.flatMap((c) => c.a ?? []));
  const B = mergePeople(work.chunks.flatMap((c) => c.b ?? []));
  if (A.length === 0) return fail(admin, u, "健診結果を読み取れませんでした(検査結果の載っていないPDFの可能性があります)");
  const cmp = compareReads(A, B);
  // 2回目にしか出てこなかった方も、確認待ちとして残す
  const reads = [...A, ...cmp.onlySecond];
  const readDiffs = [...cmp.diffs, ...cmp.onlySecond.map(() => [{ field: "読み取り", a: "", b: "2回目だけに出てきました" }])];
  const ctx = await loadContext(admin, u);
  if (!ctx.rules.some((r) => r.grade !== "S")) return fail(admin, u, "判定基準が未登録のため、自動では判定できません");
  const rows = tableRows(reads, ctx, u.checkup_type!);
  // 氏名のない人は personsToTable の時点でいないので、rows と reads は同じ並び
  const coverage = coverageOf(reads.flatMap((p) => p.items.map((it) => it.k)), u.checkup_type!);
  return finalize(admin, u, actor, "pdf", rows, ctx, coverage, { reads, readDiffs });
}

// 区切りをまたいで同じ方が出てきたら、1人にまとめる(氏名と生年月日が同じ)
function mergePeople(list: ReadPerson[]): ReadPerson[] {
  const out: ReadPerson[] = [];
  const key = (p: ReadPerson) => `${p.name.replace(/[\s　]/g, "")}|${p.birth.replace(/\s/g, "")}`;
  for (const p of list) {
    const prev = out.find((q) => key(q) === key(p) && Math.abs(q.page - p.page) <= 2);
    if (!prev) {
      out.push({ ...p, items: [...p.items] });
      continue;
    }
    for (const it of p.items) {
      if (!prev.items.some((x) => x.k === it.k && (x.l ?? "") === (it.l ?? ""))) prev.items.push(it);
    }
    for (const f of ["kana", "sex", "emp_no", "dept", "date", "overall"] as const) if (!prev[f]) prev[f] = p[f];
  }
  return out;
}

// 読み取りを1区切り進める
export async function runStep(admin: SupabaseClient, uploadId: string, actor: Actor): Promise<RunState> {
  const u = await loadUpload(admin, uploadId);
  if (!u) return { status: "failed", progress: null, result: null, error: "ファイルが見つかりません" };
  if (u.status !== "pending" || u.read_status === "done" || u.read_status === "review" || u.read_status === "failed") return stateOf(u);
  if (!u.fiscal_year || !u.checkup_type) return fail(admin, u, "年度・健診の種類が指定されていません");

  // 二重に動かさない(ほかの画面で読み取り中なら待つ)。4分たっても終わらないものは、止まったとみなして引き継ぐ
  const now = new Date();
  const cutoff = new Date(now.getTime() - 240_000).toISOString();
  const { data: locked } = await admin
    .from("hm_csv_uploads")
    .update({ read_updated_at: now.toISOString(), read_status: "reading" })
    .eq("id", u.id)
    .or(`read_updated_at.is.null,read_updated_at.lt.${cutoff}`)
    .select("id");
  if (!locked || locked.length === 0) return { ...stateOf(u), busy: true };

  try {
    if ((u.kind ?? "csv") === "pdf") return await runPdf(admin, u, actor);
    if (!u.file_hash && u.content) await admin.from("hm_csv_uploads").update({ file_hash: sha256(u.content) }).eq("id", u.id);
    return await runCsv(admin, u, actor);
  } catch (e) {
    console.error("auto read failed", e);
    // 一時的な失敗(通信・AIの混雑)は、もう一度押せば続きから進められるようにする
    await admin.from("hm_csv_uploads").update({ read_updated_at: null, read_error: "読み取りの途中で止まりました。もう一度お試しください" }).eq("id", u.id);
    const again = await loadUpload(admin, uploadId);
    return { ...(again ? stateOf(again) : { status: "reading", progress: null, result: null }), error: "読み取りの途中で止まりました。「続ける」を押すと、続きから進みます" };
  }
}

// 確認待ちの方を取り込む(事務所)。choices: 食い違いのあった項目で、2回目の読み取りを採るもの
export async function approveHeld(admin: SupabaseClient, uploadId: string, actor: Actor, indexes: number[], choices: Record<string, string[]>, skip: boolean): Promise<RunState> {
  const u = await loadUpload(admin, uploadId);
  if (!u || !u.read_result) return { status: "failed", progress: null, result: null, error: "ファイルが見つかりません" };
  const result: ReadResult = { ...u.read_result, people: u.read_result.people.map((p) => ({ ...p })) };
  const ctx = await loadContext(admin, u);
  const people: ReturnType<typeof toApply>[] = [];
  const errors: string[] = [];
  for (const i of indexes) {
    const p = result.people[i];
    if (!p || p.status !== "hold" || !p.row) continue;
    if (skip) {
      result.people[i] = { ...p, status: "skipped", row: undefined, read: undefined };
      continue;
    }
    let row = p.row;
    // 食い違いのうち「2回目を採る」とした項目は、2回目の値に置き換えて、判定し直す
    const useB = choices[String(i)] ?? [];
    if (p.read && p.diffKind === "read" && useB.length > 0) {
      const read: ReadPerson = { ...p.read, items: p.read.items.map((it) => ({ ...it })) };
      for (const d of p.diffs) {
        if (!useB.includes(d.field)) continue;
        if (d.field === "氏名") read.name = d.b;
        else if (d.field === "生年月日") read.birth = d.b;
        else if (d.field === "性別") read.sex = d.b;
        else if (d.field === "健診日") read.date = d.b;
        else {
          const t = personsToTable([read]);
          const col = t.header.indexOf(d.field);
          const it = read.items.find((x) => (x.l ?? "").trim() === d.field) ?? (col >= 8 ? read.items.find((x) => x.k === (t.colModes[col] as { itemKey: string }).itemKey && !x.l) : undefined);
          if (it) it.v = d.b;
        }
      }
      row = tableRows([read], ctx, u.checkup_type!)[0] ?? row;
    }
    const against = classifyAgainstExisting(row, ctx.existing);
    if (against.mode === "conflict") {
      errors.push(`${p.name}さん: すでに登録されている結果と値が違うため、ここからは取り込めません(個人の画面で値を直してください)`);
      continue;
    }
    const sex = row.sex === "male" || row.sex === "female" ? row.sex : null;
    if (against.mode === "same") {
      result.people[i] = { ...p, status: "same", reasons: [], diffs: [], row: undefined, read: undefined };
      continue;
    }
    const existing = against.mode === "add" ? against.existing : null;
    const items = against.mode === "add" ? against.items : row.items;
    const all = existing ? [...existing.items.map((it) => ({ name: it.item_name, value: it.value, judgment: it.judgment })), ...items] : row.items;
    const mayJudge = !existing || !existing.work_judgment || existing.work_judgment_auto;
    const wj = mayJudge ? decideWorkJudgment(row.overall_judgment, all, sex, u.checkup_type!, ctx.rules) : null;
    people.push(toApply(row, existing ? "add" : "new", existing?.id ?? null, items, wj, p.page, needsFollowup(row.overall_judgment, all, sex, ctx.rules)));
    result.people[i] = { ...p, name: row.target_name, birth: row.birth_date, overall: row.overall_judgment, status: existing ? "added" : "imported", judgment: wj, reasons: [], row: undefined, read: undefined };
  }
  // 要約を作り直す
  const done = result.people.filter((p) => p.status === "imported" || p.status === "added");
  result.summary = {
    total: result.people.length,
    imported: result.people.filter((p) => p.status === "imported").length,
    added: result.people.filter((p) => p.status === "added").length,
    same: result.people.filter((p) => p.status === "same").length,
    held: result.people.filter((p) => p.status === "hold").length,
    normal: done.filter((p) => p.judgment?.judgment === "normal" && !p.judgment.condition).length,
    consult: done.filter((p) => p.judgment?.judgment === "normal" && p.judgment.condition === "consult").length,
    pending: done.filter((p) => p.judgment?.judgment === "pending").length,
    unjudged: done.filter((p) => !p.judgment).length,
  };
  const state = await apply(admin, u, actor, people, result);
  return errors.length > 0 ? { ...state, error: errors.join("\n") } : state;
}

// 保管の期限(5年)を過ぎた原本を消す。取り込んだ健診データは残る
export async function purgeOldUploads(admin: SupabaseClient): Promise<number> {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 5);
  const { data } = await admin.from("hm_csv_uploads").select("id, storage_path").lt("created_at", cutoff.toISOString()).limit(20);
  const rows = (data ?? []) as { id: string; storage_path: string | null }[];
  if (rows.length === 0) return 0;
  const paths = rows.map((r) => r.storage_path).filter((p): p is string => Boolean(p));
  if (paths.length > 0) await admin.storage.from("hm-files").remove(paths);
  await admin.from("hm_csv_uploads").delete().in("id", rows.map((r) => r.id));
  return rows.length;
}
