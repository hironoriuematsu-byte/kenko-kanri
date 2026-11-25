import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCsv, parseKinds } from "@/lib/checkups";
import { canonKind, hintedKinds, kindOfLabel, resolveSection, sameSection, sectionKey, sectionLabel, splitColumns, KIND_GENERAL, type Section } from "@/lib/checkupKinds";
import { buildImportRows, guessColumns, type ImportItem, type ImportRow } from "@/lib/importRows";
import { normalizeCodedColumns, workplacesIn } from "@/lib/codedColumns";
import type { JudgmentRule } from "@/lib/judgment";
import type { PersonCandidate } from "@/lib/personMatch";
import {
  applyAiMapping,
  applySpecialColumns,
  canonicalHeaders,
  coverageOf,
  findHeaderRow,
  keysWithData,
  classifyAgainstExisting,
  compareReads,
  reconcileReads,
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
import { PDF_PAGES_PER_CHUNK, aiReady, mapCsvColumns, pdfPageCount, pdfSlice, readPdfPart, type ReadMode } from "@/lib/autoReadServer";

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

// c: 2回の読み取りが食い違ったときだけ読む3回目(多数決に使う)
// sk: 定期健診として読んだとき、この区切りに載っていた特殊健診の種類 / s: その特殊健診の部分を読んだ結果
type Reads = { a?: ReadPerson[]; b?: ReadPerson[]; c?: ReadPerson[] };
type Chunk = { from: number; to: number; done: boolean; sk?: string[]; s?: Reads & { done: boolean; failed?: boolean } } & Reads;
const CHUNKS_PER_STEP = 2; // 1回の呼び出しで、同時に読む区切りの数
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
  cautions?: string[]; // 止めずに取り込んだが、知らせておくこと
  // どの健診の結果として登録するか(1つのファイルに複数の種類が入っているとき。無ければ、送るときに選んだ種別・種類)
  section?: Section;
  needsKind?: boolean; // どの健診の結果か見分けられなかった(事務所が種類を選んで取り込む)
  // 確認待ちの方だけ: 承認のときに使う
  row?: ImportRow;
  read?: ReadPerson; // PDFから読んだ内容(食い違いのどちらを採るか選べるように)
};
// otherRound: 別の回(2回目など)の健診とみられるため、ファイル全体を止めている(事務所が実施回を直して読み直せる)
// notes: 止めずに取り込んだが、知らせておくこと(「○○さん: 健診日が年度の外」など)
// sections: このファイルから見つかった健診の種類と人数(複数の種類が入っていたとき)
export type ReadResult = {
  kind: "csv" | "pdf";
  summary: ReadSummary;
  people: StoredPerson[];
  at: string;
  coverage?: Coverage;
  otherRound?: boolean;
  notes?: string[];
  sections?: { label: string; type: string; kind: string | null; count: number }[];
};

export type RunState = {
  status: string; // none / reading / review / done / failed
  progress: { done: number; total: number } | null;
  result: ReadResult | null;
  error: string | null;
  busy?: boolean;
  retry?: boolean; // 一時的な失敗。画面が少し待ってから、続きを自動で呼ぶ
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
      .select("id, person_id, employee_no, target_name, birth_date, sex, special_kind, work_judgment, work_judgment_auto, checkup_date")
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

// このファイルを送るときに選んだ種別・種類(特殊健診で種類が1つのとき。おまかせ・複数のときは kind = null)
export function ownSection(u: Upload): Section {
  if (u.checkup_type !== "special") return { type: u.checkup_type ?? "regular", kind: null };
  const declared = parseKinds(u.special_kind);
  return { type: "special", kind: declared.length === 1 ? declared[0] : null };
}
// データベースの取込関数(SQL 0161 より前)は、ファイルの種別・種類をそのまま全員に付ける。
// それと違う区分で登録する行があるかどうか
const needsRowSection = (u: Upload, s: Section) => s.type !== u.checkup_type || (s.type === "special" && (s.kind ?? "") !== (u.special_kind ?? "").trim());
// 区分ごとの、判定基準・名簿・すでに登録されている結果(同じ区分を何度も読まない)
function contextCache(admin: SupabaseClient, u: Upload) {
  const cache = new Map<string, ReturnType<typeof loadContext>>();
  return (s: Section) => {
    const key = sectionKey(s);
    if (!cache.has(key)) cache.set(key, loadContext(admin, { ...u, checkup_type: s.type, special_kind: s.type === "special" ? s.kind : null }));
    return cache.get(key)!;
  };
}
const tagRow = (row: ImportRow, s: Section): ImportRow => ({ ...row, checkup_type: s.type, special_kind: s.type === "special" ? s.kind : null });
const NEEDS_KIND_REASON = "どの健診の結果か、見分けられませんでした(種類を選んで取り込みます)";

const toStored = (p: PlannedPerson, read?: ReadPerson, section?: Section, needsKind?: boolean): StoredPerson => ({
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
  ...(p.cautions.length > 0 ? { cautions: p.cautions } : {}),
  ...(section ? { section } : {}),
  ...(needsKind ? { needsKind: true } : {}),
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

// 読み取った行のまとまり(区分ごと)。section が null のものは、どの健診の結果か見分けられなかった分
type SectionInput = { section: Section | null; rows: ImportRow[]; reads?: ReadPerson[]; readDiffs?: Diff[][]; labels?: string[] };

// 読み取った行から、一人ずつの扱いを決めて取り込む。
// 1つのファイルに複数の種類の健診が入っているときは、区分ごとに、すでに登録されている結果と照らして決める
async function finalize(admin: SupabaseClient, u: Upload, actor: Actor, kind: "csv" | "pdf", inputs: SectionInput[], coverage: Coverage, extraNotes: string[] = []): Promise<RunState> {
  const own = ownSection(u);
  const ctxOf = contextCache(admin, u);
  const several = inputs.length > 1 || inputs.some((inp) => !inp.section || !sameSection(inp.section, own));
  // ファイルの種別・種類と違う区分で登録するには、データベース側の対応(SQL 0161)が要る
  if (inputs.some((inp) => !inp.section || needsRowSection(u, inp.section))) {
    const { error } = await admin.rpc("hm_auto_apply_sections");
    if (error) return fail(admin, u, "1つのファイルに複数の種類の健診が入っています。種類ごとに分けて取り込むには、SQL 0161 の実行が必要です");
  }
  const plans: { p: PlannedPerson; read?: ReadPerson; section: Section; needsKind: boolean }[] = [];
  for (const inp of inputs) {
    // 見分けられなかった分は、ひとまず「特殊健診・種類なし」として照らし、全員を確認待ちにする
    const section = inp.section ?? { type: "special", kind: null };
    const ctx = await ctxOf(section);
    const plan = planPeople({
      rows: inp.rows,
      pages: inp.reads?.map((r) => r.page),
      readDiffs: inp.readDiffs,
      existing: ctx.existing,
      checkupType: section.type,
      fiscalYear: u.fiscal_year!,
      kind,
      rosterSize: ctx.persons.length,
      // 特殊健診のPDFも、設定が「確認なし」なら、読み取りがそろった方は確認なしで取り込む(就業判定は産業医が行う)
      pdfAuto: ctx.pdfAuto,
      rules: ctx.rules,
      roster: ctx.persons,
    });
    plan.forEach((p, i) => {
      const tagged = { ...p, row: tagRow(p.row, section) };
      if (inp.section) return plans.push({ p: tagged, read: inp.reads?.[i], section, needsKind: false });
      const why = inp.labels && inp.labels.length > 0 ? `${NEEDS_KIND_REASON}: ${inp.labels.slice(0, 8).join("、")}${inp.labels.length > 8 ? " ほか" : ""}` : NEEDS_KIND_REASON;
      plans.push({ p: { ...tagged, action: "hold", reasons: [why, ...p.reasons], clean: false }, read: inp.reads?.[i], section, needsKind: true });
    });
  }
  const all = plans.map((x) => x.p);
  const people = plans
    .filter(({ p }) => p.action === "import" || p.action === "add")
    .map(({ p }) => toApply(p.row, p.action === "add" ? "add" : "new", p.existingId, p.action === "add" ? p.addItems : p.row.items, p.judgment, p.page, p.needsFollowup));
  // 取り込んだ方についての知らせ(確認待ちの方の分は、確認の画面に出る)
  const notes = [...extraNotes, ...all.filter((p) => p.action !== "hold").flatMap((p) => p.cautions.map((c) => `${p.row.target_name}さん: ${c}`))];
  const result: ReadResult = {
    kind,
    summary: summarize(all),
    people: plans.map(({ p, read, section, needsKind }) => toStored(p, read, several ? section : undefined, needsKind)),
    at: new Date().toISOString(),
    coverage,
    otherRound: all.some((p) => p.otherRound),
    ...(notes.length > 0 ? { notes } : {}),
    ...(several
      ? {
          sections: inputs.map((inp) => ({
            label: inp.section ? sectionLabel(inp.section) : "種類を見分けられなかった分",
            type: inp.section?.type ?? "",
            kind: inp.section?.kind ?? null,
            count: inp.rows.length,
          })),
        }
      : {}),
  };
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
  let dataRows = table.slice(headerRow + 1).filter((r) => r.some((c) => (c ?? "").trim() !== ""));
  const ctx = await loadContext(admin, u);
  if (!ctx.rules.some((r) => r.grade !== "S")) return fail(admin, u, "判定基準が未登録のため、自動では判定できません");
  let cols = guessColumns(header);
  // 見出しから決まらなかった列があれば、AIに見出しと値の例を見せて、法定項目に当たる列を見分けてもらう
  // (氏名の列の中身は送らない)。健診機関ごとの書き方の違いを、ここで吸収する
  const baseCols = Object.values(cols.base).filter((c) => c >= 0);
  const undecided = header.some((h, i) => h.trim() !== "" && !baseCols.includes(i) && (cols.colModes[i]?.kind ?? "off") === "off" && !/判定/.test(h.normalize("NFKC")) && dataRows.some((r) => (r[i] ?? "").trim() !== ""));
  const gaps = cols.base.nameCol < 0 || cols.base.dateCol < 0 || cols.base.birthCol < 0 || cols.base.sexCol < 0;
  const special = u.checkup_type === "special";
  const declared = special ? parseKinds(u.special_kind) : [];
  // 種類の見分けが要るか: 特殊健診で種類が1つに決まっていない、または、見出しに別の種類の特殊健診の項目がある
  // (定期健診として送られたCSVに、特殊健診の列が混ざっている場合を含む)
  const hinted = hintedKinds(header);
  const wantKinds = special ? declared.length !== 1 || hinted.some((k) => canonKind(declared[0]) !== k) : hinted.length > 0;
  let specialCols: number[] | null = null; // AIが「特殊健診の項目」と見分けた列
  const colKinds: Record<number, string> = {}; // AIが見分けた、列ごとの健診の種類
  if ((gaps || undecided || wantKinds) && aiReady()) {
    try {
      const ai = await mapCsvColumns(header, dataRows.slice(0, 3), [cols.base.nameCol, cols.base.kanaCol].filter((c) => c >= 0), special || wantKinds, wantKinds ? { declared } : null);
      cols = applyAiMapping(header, cols, ai);
      if ((special || wantKinds) && Array.isArray(ai.special)) specialCols = ai.special.filter((c) => Number.isInteger(c));
      for (const k of ai.kinds ?? []) if (Number.isInteger(k.col) && k.col >= 0 && k.col < header.length && typeof k.kind === "string") colKinds[k.col] = k.kind;
    } catch (e) {
      console.error("csv mapping by AI failed", e);
    }
  }
  // 特殊健診は、法定項目のほかに、作業条件・代謝物・物質ごとの判定なども取り込む(労基署報告の集計に使う)
  if (special) cols = { base: cols.base, colModes: applySpecialColumns(header, dataRows, cols, specialCols) };
  else if (wantKinds) {
    // 定期健診として送られたCSV: 特殊健診の項目と分かった列だけを足す(それ以外の列は、今までどおり取り込まない)
    const isSpecialCol = (i: number) => {
      const t = canonKind(colKinds[i]) || kindOfLabel(header[i]) || "";
      return t !== "" && t !== KIND_GENERAL && resolveSection("regular", [], t) !== "unknown";
    };
    const pool = (specialCols ?? header.map((_, i) => i)).filter(isSpecialCol);
    cols = { base: cols.base, colModes: applySpecialColumns(header, dataRows, cols, pool) };
  }
  if (cols.base.nameCol < 0) return fail(admin, u, "氏名の列が見つかりませんでした。手作業の取込(列を指定する画面)をお使いください");
  if (!Object.values(cols.colModes).some((m) => m.kind !== "off")) return fail(admin, u, "検査項目の列が見つかりませんでした。手作業の取込(列を指定する画面)をお使いください");
  // AIが見分けた列は、あとの判定・集計で同じ法定項目として扱える名前にそろえる
  const canon = canonicalHeaders(header, cols.colModes);
  header = canon.header;
  // 所見の有無を 1・2 の区分番号で載せている列は、ファイルの中身から番号の向きを確かめて、文字(所見なし・所見あり)に直す
  dataRows = normalizeCodedColumns(header, dataRows, cols.colModes).rows;
  // 複数の事業場(会社)の方が入っているファイルは、止めずに取り込み、事業場ごとの人数を知らせる
  const places = workplacesIn(header, dataRows);
  const placeNotes = places.length > 0 ? [`このファイルには、複数の事業場の方が入っています(${places.map((p) => `${p.name} ${p.count}名`).join("、")})。この企業の方でない分が混ざっていないか、ご確認ください`] : [];
  const build = (base: typeof cols.base, colModes: typeof cols.colModes, type: string, rowsOf: string[][] = dataRows) =>
    buildImportRows({ header, dataRows: rowsOf, base, colModes, autoJudge: true, rules: ctx.rules, checkupType: type, commonDate: "", persons: ctx.persons });

  if (!wantKinds) {
    // 種類は1つ(送るときに選んだ種別・種類のまま)
    const rows = build(cols.base, cols.colModes, u.checkup_type!);
    if (rows.length === 0) return fail(admin, u, "氏名のある行がありませんでした");
    const coverage = coverageOf(keysWithData(dataRows, cols.colModes), u.checkup_type!, canon.renamed);
    // 特殊健診は、取り込んだ項目名をそのまま知らせる
    if (special) coverage.found = header.filter((h, i) => (cols.colModes[i]?.kind ?? "off") !== "off" && dataRows.some((r) => (r[i] ?? "").trim() !== "")).map((h) => h.trim());
    return finalize(admin, u, actor, "csv", [{ section: ownSection(u), rows }], coverage, placeNotes);
  }

  // 列を健診の種類ごとに分けて、種類ごとの記録にする。
  // その種類の列(どの種類にも当たる「共通」の列を除く)に値が1つも入っていない方は、その種類の記録を作らない
  const split = splitColumns({ header, base: cols.base, colModes: cols.colModes, colKinds, declaredType: u.checkup_type!, declared });
  const having = (own: number[]) => dataRows.filter((r) => own.some((i) => (r[i] ?? "").trim() !== ""));
  const inputs: SectionInput[] = split.sections
    .map((x) => ({ section: x.section as Section | null, rows: build(x.base, x.colModes, x.section.type, having(x.own)).filter((r) => r.items.length > 0) }))
    .filter((x) => x.rows.length > 0);
  if (split.unknown) {
    const rows = build(split.unknown.base, split.unknown.colModes, "special", having(split.unknown.own)).filter((r) => r.items.length > 0);
    if (rows.length > 0) inputs.push({ section: null, rows, labels: split.unknown.labels });
  }
  if (inputs.length === 0) return fail(admin, u, "検査値の入っている行がありませんでした");
  const general = split.sections.find((x) => x.section.type !== "special");
  const coverage = coverageOf(keysWithData(dataRows, general?.colModes ?? {}), general?.section.type ?? u.checkup_type!, canon.renamed);
  if (!general) coverage.found = header.filter((h, i) => (cols.colModes[i]?.kind ?? "off") !== "off" && dataRows.some((r) => (r[i] ?? "").trim() !== "")).map((h) => h.trim());
  return finalize(admin, u, actor, "csv", inputs, coverage, placeNotes);
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

  const special = u.checkup_type === "special";
  const declared = special ? parseKinds(u.special_kind) : [];
  // 同じページを2回読ませて突き合わせる。食い違ったら、3回目を読んで多数決にする
  const readTwice = async (c: Chunk, mode: ReadMode): Promise<(Reads & { kinds: string[] }) | "truncated"> => {
    const part = await pdfSlice(bytes, c.from, c.to);
    const [a, b] = await Promise.all([readPdfPart(part, c.from - 1, mode), readPdfPart(part, c.from - 1, mode)]);
    if (a.truncated || b.truncated) return "truncated";
    const kinds = [...a.specialKinds, ...b.specialKinds];
    const cmp = compareReads(a.persons, b.persons);
    let third: ReadPerson[] | undefined;
    if (cmp.onlySecond.length > 0 || cmp.diffs.some((d) => d.length > 0)) {
      try {
        const r = await readPdfPart(part, c.from - 1, mode);
        if (!r.truncated) {
          third = r.persons;
          kinds.push(...r.specialKinds);
        }
      } catch (e) {
        console.error("third read failed", e); // 3回目が読めなければ、2回の突き合わせのまま進める
      }
    }
    return { a: a.persons, b: b.persons, ...(third ? { c: third } : {}), kinds: Array.from(new Set(kinds)) };
  };
  // 定期健診として読んだあと、特殊健診の結果が載っていた区切りは、その部分をもう一度読む
  const pendingSpecial = () => (special ? [] : work!.chunks.filter((c) => c.done && (c.sk?.length ?? 0) > 0 && !c.s?.done));
  const progressOf = () => {
    const extra = special ? [] : work!.chunks.filter((c) => (c.sk?.length ?? 0) > 0);
    return { done: work!.chunks.filter((x) => x.done).length + extra.filter((c) => c.s?.done).length, total: work!.chunks.length + extra.length };
  };

  const todo = work.chunks.filter((c) => !c.done).slice(0, CHUNKS_PER_STEP);
  if (todo.length > 0) {
    const mode: ReadMode = special ? { special: true, declared } : { special: false };
    const readChunk = async (c: Chunk): Promise<Chunk | "truncated"> => {
      const r = await readTwice(c, mode);
      if (r === "truncated") return "truncated";
      const { kinds, ...reads } = r;
      return { ...c, done: true, ...reads, ...(kinds.length > 0 ? { sk: kinds } : {}) };
    };
    const settled = await Promise.allSettled(todo.map(readChunk));
    let progressed = false;
    let firstError: unknown = null;
    for (let n = 0; n < todo.length; n++) {
      const c = todo[n];
      const r = settled[n];
      const at = work.chunks.indexOf(c);
      if (r.status === "rejected") {
        firstError = firstError ?? r.reason;
        continue;
      }
      progressed = true;
      if (r.value === "truncated") {
        // 1ページに人数が多くて書き出しきれなかった: 1ページずつに分けて読み直す
        if (c.to === c.from) return fail(admin, u, `${c.from}ページ目に載っている人数が多く、読み取りきれませんでした。手作業の取込をお使いください`);
        const singles: Chunk[] = Array.from({ length: c.to - c.from + 1 }, (_, k) => ({ from: c.from + k, to: c.from + k, done: false }));
        work.chunks.splice(at, 1, ...singles);
      } else {
        work.chunks[at] = r.value;
      }
    }
    // 読めた区切りは残す(一時的な失敗があっても、次はその続きから)
    if (progressed) await admin.from("hm_csv_uploads").update({ read_work: work, read_updated_at: null }).eq("id", u.id);
    if (firstError) throw firstError;
    if (work.chunks.some((x) => !x.done) || pendingSpecial().length > 0) {
      return { status: "reading", progress: progressOf(), result: null, error: null };
    }
  }

  // 定期健診のファイルに特殊健診の結果が載っていたとき: その区切りを、特殊健診として読む(定期健診の項目は除く)
  const extraNotes: string[] = [];
  const todoSpecial = pendingSpecial().slice(0, CHUNKS_PER_STEP);
  if (todoSpecial.length > 0) {
    const settled = await Promise.allSettled(todoSpecial.map((c) => readTwice(c, { special: true, declared: c.sk ?? [], excludeGeneral: true })));
    let progressed = false;
    let firstError: unknown = null;
    settled.forEach((r, n) => {
      const c = todoSpecial[n];
      if (r.status === "rejected") {
        firstError = firstError ?? r.reason;
        return;
      }
      progressed = true;
      if (r.value === "truncated") c.s = { done: true, failed: true };
      else {
        const { kinds: _kinds, ...reads } = r.value;
        void _kinds;
        c.s = { done: true, ...reads };
      }
    });
    if (progressed) await admin.from("hm_csv_uploads").update({ read_work: work, read_updated_at: null }).eq("id", u.id);
    if (firstError) throw firstError;
    if (pendingSpecial().length > 0) return { status: "reading", progress: progressOf(), result: null, error: null };
  }
  for (const c of work.chunks) {
    if (c.s?.failed) extraNotes.push(`${c.from}ページ付近に載っている特殊健診の結果は、読み取りきれませんでした(健診種別を「特殊健診」にして、送り直してください)`);
  }

  // 全部読み終えた: 読み取りを突き合わせて(2回以上そろった値を採る)、判定・取込へ
  const A = mergePeople(work.chunks.flatMap((c) => c.a ?? []));
  const B = mergePeople(work.chunks.flatMap((c) => c.b ?? []));
  const C = mergePeople(work.chunks.flatMap((c) => thirdOf(c)));
  // 定期健診のファイルに載っていた特殊健診の部分
  const SA = mergePeople(work.chunks.flatMap((c) => c.s?.a ?? []));
  const SB = mergePeople(work.chunks.flatMap((c) => c.s?.b ?? []));
  const SC = mergePeople(work.chunks.flatMap((c) => (c.s ? thirdOf(c.s) : [])));
  if (A.length === 0 && B.length === 0 && SA.length === 0 && SB.length === 0) return fail(admin, u, "健診結果を読み取れませんでした(検査結果の載っていないPDFの可能性があります)");
  const main = reconcileReads(A, B, C);
  const extra = SA.length > 0 || SB.length > 0 ? reconcileReads(SA, SB, SC) : { reads: [], diffs: [] };
  const own = ownSection(u);
  const ctxOf = contextCache(admin, u);
  if (!(await ctxOf(own)).rules.some((r) => r.grade !== "S")) return fail(admin, u, "判定基準が未登録のため、自動では判定できません");

  // 読み取った結果を、健診の種類ごとに分ける(札のないもの = 定期健診として読んだ分は、送るときに選んだ種別のまま)
  const groups = new Map<string, { section: Section | null; reads: ReadPerson[]; readDiffs: Diff[][] }>();
  const put = (read: ReadPerson, diff: Diff[], sec: Section | "unknown") => {
    const key = sec === "unknown" ? "?" : sectionKey(sec);
    const g = groups.get(key) ?? { section: sec === "unknown" ? null : sec, reads: [], readDiffs: [] };
    g.reads.push(read);
    g.readDiffs.push(diff);
    groups.set(key, g);
  };
  main.reads.forEach((r, i) => put(r, main.diffs[i] ?? [], special ? resolveSection("special", declared, r.kind) : own));
  // 定期健診のファイルに載っていた特殊健診: 種類がはっきり読めたものはその種類に。そうでないものは事務所が選ぶ
  extra.reads.forEach((r, i) => put(r, extra.diffs[i] ?? [], !r.kind || r.kind === KIND_GENERAL ? "unknown" : resolveSection(u.checkup_type!, [], r.kind)));

  const inputs: SectionInput[] = [];
  for (const g of Array.from(groups.values())) {
    const type = g.section?.type ?? "special";
    const ctx = await ctxOf(g.section ?? { type: "special", kind: null });
    // 氏名のない人は読み取りの時点でいないので、rows と reads は同じ並び
    inputs.push({ section: g.section, rows: tableRows(g.reads, ctx, type), reads: g.reads, readDiffs: g.readDiffs });
  }
  const generalReads = inputs.filter((x) => x.section && x.section.type !== "special").flatMap((x) => x.reads ?? []);
  const coverage = coverageOf(generalReads.flatMap((p) => p.items.map((it) => it.k)), generalReads.length > 0 ? inputs.find((x) => x.section && x.section.type !== "special")!.section!.type : u.checkup_type!);
  if (generalReads.length === 0) coverage.found = Array.from(new Set(inputs.flatMap((x) => x.reads ?? []).flatMap((p) => p.items.map((it) => (it.l ?? "").trim()).filter(Boolean))));
  return finalize(admin, u, actor, "pdf", inputs, coverage, extraNotes);
}

// 多数決に使う3回目の読み取り。2回の読み取りがそろった区切りは3回目を読まないので、1回目と同じものを使う。
// 食い違ったのに3回目を読めなかった区切りは、何も足さない(2回の突き合わせのまま、食い違いとして確認待ちに残す)
function thirdOf(r: Reads): ReadPerson[] {
  if (r.c) return r.c;
  const cmp = compareReads(r.a ?? [], r.b ?? []);
  const agree = cmp.onlySecond.length === 0 && cmp.diffs.every((d) => d.length === 0);
  return agree ? (r.a ?? []) : [];
}

// 区切りをまたいで同じ方が出てきたら、1人にまとめる(氏名と生年月日が同じ)
function mergePeople(list: ReadPerson[]): ReadPerson[] {
  const out: ReadPerson[] = [];
  // 1人に複数の種類の健診があるときは、種類ごとに別の要素のままにする
  const key = (p: ReadPerson) => `${p.name.replace(/[\s　]/g, "")}|${p.birth.replace(/\s/g, "")}|${p.kind ?? ""}`;
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
    return { ...(again ? stateOf(again) : { status: "reading", progress: null, result: null }), error: "読み取りの途中で止まりました。「続ける」を押すと、続きから進みます", retry: true };
  }
}

// 確認待ちの方を取り込む(事務所)。choices: 食い違いのあった項目で、2回目の読み取りを採るもの
// kinds: どの健診の結果か見分けられなかった方について、事務所が選んだ種類(番号 → 特殊健診の種類、または「一般」= 定期健診)
export async function approveHeld(admin: SupabaseClient, uploadId: string, actor: Actor, indexes: number[], choices: Record<string, string[]>, skip: boolean, kinds: Record<string, string> = {}): Promise<RunState> {
  const u = await loadUpload(admin, uploadId);
  if (!u || !u.read_result) return { status: "failed", progress: null, result: null, error: "ファイルが見つかりません" };
  const result: ReadResult = { ...u.read_result, people: u.read_result.people.map((p) => ({ ...p })) };
  const own = ownSection(u);
  const ctxOf = contextCache(admin, u);
  const people: ReturnType<typeof toApply>[] = [];
  const errors: string[] = [];
  for (const i of indexes) {
    const p = result.people[i];
    if (!p || p.status !== "hold" || !p.row) continue;
    if (skip) {
      result.people[i] = { ...p, status: "skipped", row: undefined, read: undefined };
      continue;
    }
    // どの健診の結果として登録するか。見分けられなかった方は、事務所が選んだ種類にする
    let section = p.section ?? own;
    if (p.needsKind) {
      const chosen = canonKind(kinds[String(i)]);
      if (!chosen) {
        errors.push(`${p.name}さん: どの健診の結果か、種類を選んでください`);
        continue;
      }
      section = chosen === KIND_GENERAL ? { type: u.checkup_type && u.checkup_type !== "special" ? u.checkup_type : "regular", kind: null } : { type: "special", kind: chosen };
    }
    if (needsRowSection(u, section)) {
      const { error } = await admin.rpc("hm_auto_apply_sections");
      if (error) {
        errors.push("種類ごとに分けて取り込むには、SQL 0161 の実行が必要です");
        break;
      }
    }
    const ctx = await ctxOf(section);
    let row = p.row;
    // 種類を選び直した方は、その種類として判定し直す(PDFから読んだ内容が残っているとき)
    if (p.needsKind && p.read) row = tableRows([p.read], ctx, section.type)[0] ?? row;
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
      row = tableRows([read], ctx, section.type)[0] ?? row;
    }
    row = tagRow(row, section);
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
    const wj = mayJudge ? decideWorkJudgment(row.overall_judgment, all, sex, section.type, ctx.rules) : null;
    people.push(toApply(row, existing ? "add" : "new", existing?.id ?? null, items, wj, p.page, needsFollowup(row.overall_judgment, all, sex, ctx.rules)));
    result.people[i] = {
      ...p,
      name: row.target_name,
      birth: row.birth_date,
      overall: row.overall_judgment,
      status: existing ? "added" : "imported",
      judgment: wj,
      reasons: [],
      row: undefined,
      read: undefined,
      ...(p.section || p.needsKind ? { section } : {}),
      needsKind: undefined,
    };
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

// 実施回を直して、読み直す(事務所)。別の回の健診を、違う回として送ってしまったファイルのため。
// このファイルからまだ誰も取り込んでいないときだけ使える。読み取りは、はじめからやり直す
export async function changeRound(admin: SupabaseClient, uploadId: string, actor: Actor, round: number): Promise<RunState> {
  const u = await loadUpload(admin, uploadId);
  if (!u) return { status: "failed", progress: null, result: null, error: "ファイルが見つかりません" };
  if (u.status !== "pending" || u.read_status !== "review" || !u.read_result) return stateOf(u);
  if (!Number.isInteger(round) || round < 1 || round > 4 || round === (u.round ?? 1)) return { ...stateOf(u), error: "実施回の指定が正しくありません" };
  if (u.read_result.people.some((p) => p.status === "imported" || p.status === "added")) {
    return { ...stateOf(u), error: "このファイルからすでに取り込んだ方がいるため、実施回は変えられません。取り込んだ方を取り消してから、ファイルを送り直してください" };
  }
  const { error } = await admin
    .from("hm_csv_uploads")
    .update({ round, read_status: "none", read_work: null, read_result: null, read_error: null, read_updated_at: null })
    .eq("id", u.id);
  if (error) return { ...stateOf(u), error: "実施回を変えられませんでした" };
  await admin.from("hm_access_logs").insert({ user_id: actor.id, action: "update", target_table: "hm_csv_uploads", target_id: u.id, detail: { company_id: u.company_id, change: "round", from: u.round ?? 1, to: round } });
  return runStep(admin, uploadId, actor);
}

// はじめから読み直す(事務所)。読み取りの仕組みを直したあとや、確認待ちが多すぎるときに使う。
// このファイルからまだ誰も取り込んでいないときだけ使える
export async function rereadUpload(admin: SupabaseClient, uploadId: string, actor: Actor): Promise<RunState> {
  const u = await loadUpload(admin, uploadId);
  if (!u) return { status: "failed", progress: null, result: null, error: "ファイルが見つかりません" };
  if (u.status !== "pending" || (u.read_status !== "review" && u.read_status !== "failed")) return stateOf(u);
  if (u.read_result?.people.some((p) => p.status === "imported" || p.status === "added")) {
    return { ...stateOf(u), error: "このファイルからすでに取り込んだ方がいるため、読み直せません。残りの方は、内容を確かめて取り込んでください" };
  }
  const { error } = await admin.from("hm_csv_uploads").update({ read_status: "none", read_work: null, read_result: null, read_error: null, read_updated_at: null }).eq("id", u.id);
  if (error) return { ...stateOf(u), error: "読み直せませんでした" };
  await admin.from("hm_access_logs").insert({ user_id: actor.id, action: "update", target_table: "hm_csv_uploads", target_id: u.id, detail: { company_id: u.company_id, change: "reread" } });
  return runStep(admin, uploadId, actor);
}
