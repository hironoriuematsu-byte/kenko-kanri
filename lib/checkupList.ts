import { createClient } from "@/lib/supabase/server";
import type { CheckupRow } from "@/components/CheckupsTable";
import { getOfficeInfo, type OfficeInfo } from "@/lib/officeInfo";
import { summarizeByCategory, type CategorySummary, type ReportItem } from "@/lib/checkupReport";
import { CHECKUP_TYPES, isFindingJudgment, isRestrictionJudgment, needsAttention } from "@/lib/checkups";
import { getJudgmentRules } from "@/lib/judgmentRules";
import type { JudgmentRule } from "@/lib/judgment";
import { fetchCheckupItems } from "@/lib/checkupItems";
import { gradeFromValue } from "@/lib/gradeFromValue";

// 健康診断管理の集計値(一覧の上の表)
export type CheckupStats = {
  total: number;
  findings: number; // 有所見者(C以上)
  rate: number | null; // 10名未満は null
  instructed: number; // 医師の指示人数(総合判定D)
  instructedRate: number | null;
  restrictionCount: number; // 就業制限項目(R)を持つ方
  attention: number; // 就業判定 要対応(未判定・判定保留)
  held: number; // 判定保留
  restricted: number; // 要就業制限・要休業
  followupPending: number;
  followupRecommended: number;
  followupDone: number;
};

// 定期健康診断結果報告書(様式第6号)の転記用(定期健診のみ)
export type Form6Summary = {
  regularCount: number;
  categorySummary: CategorySummary[];
  lastCheckupDate: string | undefined;
};

// 一覧(findingItems 付き)と検査項目から集計を求める。実際の画面とデモで共用
export function computeCheckupStats(list: CheckupRow[], items: ReportItem[]): { stats: CheckupStats; form6: Form6Summary } {
  const total = list.length;
  // 有所見者: 取込時の判定(has_findings。総合判定または検査項目のいずれかが C・D・E・R)に加え、
  // 事務所基準で補った項目判定も含めて C 以上の判定がある方。B(軽度異常)は数えない
  const findings = list.filter(
    (c) =>
      c.has_findings ||
      isFindingJudgment(c.overall_judgment) ||
      (c.findingItems ?? []).some((it) => isFindingJudgment(it.judgment))
  ).length;
  // 医師の指示人数は総合判定 D で集計する
  const instructed = list.filter((c) => (c.overall_judgment ?? "").trim().charAt(0).toUpperCase() === "D").length;
  const pct = (n: number) => (total >= 10 ? Math.round((n / total) * 1000) / 10 : null); // 個人特定防止: 10名未満は率を出さない
  const stats: CheckupStats = {
    total,
    findings,
    rate: pct(findings),
    instructed,
    instructedRate: pct(instructed),
    restrictionCount: list.filter((c) => (c.findingItems ?? []).some((it) => isRestrictionJudgment(it.judgment))).length,
    attention: list.filter((c) => needsAttention(c.work_judgment)).length,
    held: list.filter((c) => c.work_judgment === "pending").length,
    restricted: list.filter((c) => c.work_judgment === "restricted" || c.work_judgment === "leave").length,
    followupPending: list.filter((c) => c.followup_status === "pending").length,
    followupRecommended: list.filter((c) => c.followup_status === "recommended").length,
    followupDone: list.filter((c) => c.followup_status === "done").length,
  };

  const regularIds = new Set(list.filter((c) => c.checkup_type === "regular").map((c) => c.id));
  const form6: Form6Summary = {
    regularCount: regularIds.size,
    categorySummary: summarizeByCategory(items.filter((it) => regularIds.has(it.checkup_id))),
    lastCheckupDate: list
      .filter((c) => regularIds.has(c.id))
      .map((c) => c.checkup_date)
      .filter(Boolean)
      .sort()
      .slice(-1)[0] ?? undefined,
  };
  return { stats, form6 };
}

// 健診の区分(定期健診 / 雇入時健診 / 特殊健診(種類ごと))。区分ごとに一覧・集計を分けて表示する
export type CheckupGroup = {
  key: string; // "regular" / "hiring" / "special:有機溶剤" など(URLの group= に使う)
  type: string; // checkup_type
  kind: string | null; // special_kind(特殊健診のみ)
  label: string;
  count: number; // その年度の受診者数(全実施回)
};

export function groupKeyOf(type: string, kind: string | null | undefined): string {
  return type === "special" ? `special:${(kind ?? "").trim()}` : type;
}

export type CheckupListData = {
  officeInfo: OfficeInfo | null;
  groups: CheckupGroup[];
  group: CheckupGroup | null;
  groupQuery: string; // 例: "&group=special%3A%E6%9C%89%E6%A9%9F"
  rules: JudgmentRule[];
  years: number[];
  year: number | undefined;
  rounds: number[];
  round: number;
  roundQuery: string;
  list: CheckupRow[];
  items: ReportItem[];
  stats: CheckupStats;
  form6: Form6Summary;
};

// 企業×年度(×実施回)の健診一覧と集計をまとめて読む(健康診断管理と労基署報告の画面で共用)
export async function loadCheckupList(
  companyId: string,
  selectedYear?: number,
  selectedRound?: number,
  selectedGroup?: string // 区分のキー(省略時は定期健診、無ければ最初の区分)
): Promise<CheckupListData> {
  const supabase = createClient();
  // 年度・実施回の一覧。1回の問い合わせで返る行数には上限(1000行)があり、
  // 受診者×年度が1000件を超えると古い年度が欠けてしまうため、全件を分けて取得する
  const fetchYearRows = async () => {
    const PAGE = 1000;
    const all: { fiscal_year: number; round: number | null; checkup_type: string; special_kind: string | null }[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data } = await supabase
        .from("hm_checkups")
        .select("fiscal_year, round, checkup_type, special_kind")
        .eq("company_id", companyId)
        .order("fiscal_year", { ascending: false })
        .order("round")
        .range(from, from + PAGE - 1);
      if (!data || data.length === 0) break;
      all.push(...(data as { fiscal_year: number; round: number | null; checkup_type: string; special_kind: string | null }[]));
      if (data.length < PAGE) break;
    }
    return all;
  };

  // 互いに関係のない問い合わせは同時に行い、待ち時間を短くする
  const [officeInfo, yearRows, rules] = await Promise.all([getOfficeInfo(), fetchYearRows(), getJudgmentRules()]);
  const years = Array.from(new Set((yearRows ?? []).map((r) => r.fiscal_year)));
  const year = selectedYear ?? years[0];

  // その年度の区分(定期・雇入時・特殊健診の種類ごと)。定期健診 → 雇入時 → 特殊健診(種類順) → その他 の順
  const groupMap = new Map<string, CheckupGroup>();
  for (const r of (yearRows ?? []).filter((r) => r.fiscal_year === year)) {
    const key = groupKeyOf(r.checkup_type, r.special_kind);
    const g = groupMap.get(key) ?? {
      key,
      type: r.checkup_type,
      kind: r.checkup_type === "special" ? (r.special_kind ?? "").trim() || null : null,
      label:
        (CHECKUP_TYPES[r.checkup_type] ?? r.checkup_type) +
        (r.checkup_type === "special" ? `（${(r.special_kind ?? "").trim() || "種類未設定"}）` : ""),
      count: 0,
    };
    g.count += 1;
    groupMap.set(key, g);
  }
  const typeOrder = (t: string) => (t === "regular" ? 0 : t === "hiring" ? 1 : t === "special" ? 2 : 3);
  const groups = Array.from(groupMap.values()).sort(
    (a, b) => typeOrder(a.type) - typeOrder(b.type) || (a.kind ?? "").localeCompare(b.kind ?? "", "ja")
  );
  const group = groups.find((g) => g.key === selectedGroup) ?? groups.find((g) => g.type === "regular") ?? groups[0] ?? null;
  const groupQuery = group && groups.length > 1 ? `&group=${encodeURIComponent(group.key)}` : "";

  // その区分に存在する実施回(1回だけなら選択肢は出さない)
  const rounds = Array.from(
    new Set(
      (yearRows ?? [])
        .filter((r) => r.fiscal_year === year && group && groupKeyOf(r.checkup_type, r.special_kind) === group.key)
        .map((r) => r.round ?? 1)
    )
  ).sort((a, b) => a - b);
  const round = selectedRound ?? rounds[0] ?? 1;
  const roundQuery = rounds.length > 1 ? `&round=${round}` : "";

  const listCols =
    "id, target_name, employee_no, sex, birth_date, checkup_type, special_kind, checkup_date, overall_judgment, has_findings, work_judgment, work_judgment_note, work_judgment_date, followup_status";
  const fetchList = (cols: string) => {
    let q = supabase
      .from("hm_checkups")
      .select(cols)
      .eq("company_id", companyId)
      .eq("fiscal_year", year!)
      .eq("round", round)
      .eq("checkup_type", group?.type ?? "regular");
    // 特殊健診は種類(有機溶剤・特定化学物質 など)ごとに分けて表示する
    if (group?.type === "special") q = group.kind ? q.eq("special_kind", group.kind) : q.is("special_kind", null);
    return q.order("employee_no", { ascending: true, nullsFirst: false }).order("target_name");
  };
  // 判定条件(0132)・フリガナ/所属(0133)は後から追加した列。未適用の環境では列なしで取得する
  let listRes = year ? await fetchList(`${listCols}, work_judgment_condition, target_name_kana, department`) : null;
  if (listRes?.error) listRes = await fetchList(`${listCols}, work_judgment_condition`);
  if (listRes?.error) listRes = await fetchList(listCols);
  const checkups = (listRes?.data ?? []) as unknown as (CheckupRow & { sex: string | null })[];

  // 有所見の検査項目を一覧に表示するため、該当年度分の項目をまとめて取得(分割して全件)
  const ids = checkups.map((c) => c.id);
  const items = (await fetchCheckupItems(ids)) as ReportItem[];

  // 健診機関の判定が項目ごとに入っていない場合に備え、事務所の判定基準で補って表示する
  const sexById = new Map<string, "male" | "female" | null>(
    checkups.map((c) => [c.id, (c.sex as "male" | "female" | null) ?? null])
  );
  const findingsByCheckup = new Map<string, { item_name: string; judgment: string | null; computed?: boolean; value?: string | null }[]>();
  for (const it of items) {
    // 就業制限の検討水準(R)は測定値そのもので決まるため、健診機関の判定が
    // 入っている項目でも必ず値から確かめる(例: 健診機関がDでも随時血糖300以上ならR)
    const g = gradeFromValue(it.item_name, it.value, sexById.get(it.checkup_id) ?? null, rules);
    let judgment = it.judgment;
    let computed = false;
    if (isRestrictionJudgment(g)) {
      judgment = "R";
      computed = true;
    } else if (!isFindingJudgment(judgment)) {
      // 判定が無い(または有所見に当たらない)項目は、事務所基準で判定してみる
      if (judgment) continue;
      if (!isFindingJudgment(g)) continue;
      judgment = g;
      computed = true;
    }
    const arr = findingsByCheckup.get(it.checkup_id) ?? [];
    // 値も持たせる(受診勧奨の文章で「貧血」か「多血」かを値で見分けるため)
    arr.push({ item_name: it.item_name, judgment, computed, value: it.value });
    findingsByCheckup.set(it.checkup_id, arr);
  }
  // 本人がQRコードから送った受診報告(最新1件)。0142 未適用の環境では表が無いので無視する
  const reportById = new Map<string, NonNullable<CheckupRow["report"]>>();
  if (ids.length > 0) {
    const { data: reports } = await supabase
      .from("hm_consult_reports")
      .select("checkup_id, submitted_at, visit_date, result")
      .in("checkup_id", ids)
      .order("submitted_at", { ascending: false });
    for (const r of (reports ?? []) as { checkup_id: string; submitted_at: string; visit_date: string | null; result: string | null }[]) {
      if (!reportById.has(r.checkup_id)) {
        reportById.set(r.checkup_id, { submitted_at: r.submitted_at, visit_date: r.visit_date, result: r.result });
      }
    }
  }

  const list: CheckupRow[] = checkups.map((c) => ({
    ...c,
    findingItems: findingsByCheckup.get(c.id) ?? [],
    report: reportById.get(c.id) ?? null,
  }));
  const { stats, form6 } = computeCheckupStats(list, items);

  return { officeInfo, groups, group, groupQuery, rules, years, year, rounds, round, roundQuery, list, items, stats, form6 };
}
