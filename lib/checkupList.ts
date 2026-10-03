import { createClient } from "@/lib/supabase/server";
import type { CheckupRow } from "@/components/CheckupsTable";
import { getOfficeInfo, type OfficeInfo } from "@/lib/officeInfo";
import { summarizeByCategory, type CategorySummary, type ReportItem } from "@/lib/checkupReport";
import { isFindingJudgment, isRestrictionJudgment, needsAttention } from "@/lib/checkups";
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

export type CheckupListData = {
  officeInfo: OfficeInfo | null;
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
  selectedRound?: number
): Promise<CheckupListData> {
  const supabase = createClient();
  // 年度・実施回の一覧。1回の問い合わせで返る行数には上限(1000行)があり、
  // 受診者×年度が1000件を超えると古い年度が欠けてしまうため、全件を分けて取得する
  const fetchYearRows = async () => {
    const PAGE = 1000;
    const all: { fiscal_year: number; round: number | null }[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data } = await supabase
        .from("hm_checkups")
        .select("fiscal_year, round")
        .eq("company_id", companyId)
        .order("fiscal_year", { ascending: false })
        .order("round")
        .range(from, from + PAGE - 1);
      if (!data || data.length === 0) break;
      all.push(...(data as { fiscal_year: number; round: number | null }[]));
      if (data.length < PAGE) break;
    }
    return all;
  };

  // 互いに関係のない問い合わせは同時に行い、待ち時間を短くする
  const [officeInfo, yearRows, rules] = await Promise.all([getOfficeInfo(), fetchYearRows(), getJudgmentRules()]);
  const years = Array.from(new Set((yearRows ?? []).map((r) => r.fiscal_year)));
  const year = selectedYear ?? years[0];
  // その年度に存在する実施回(1回だけなら選択肢は出さない)
  const rounds = Array.from(
    new Set((yearRows ?? []).filter((r) => r.fiscal_year === year).map((r) => r.round ?? 1))
  ).sort((a, b) => a - b);
  const round = selectedRound ?? rounds[0] ?? 1;
  const roundQuery = rounds.length > 1 ? `&round=${round}` : "";

  const listCols =
    "id, target_name, employee_no, sex, birth_date, checkup_type, special_kind, checkup_date, overall_judgment, has_findings, work_judgment, work_judgment_note, work_judgment_date, followup_status";
  const fetchList = (cols: string) =>
    supabase
      .from("hm_checkups")
      .select(cols)
      .eq("company_id", companyId)
      .eq("fiscal_year", year!)
      .eq("round", round)
      .order("employee_no", { ascending: true, nullsFirst: false })
      .order("target_name");
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
  const list: CheckupRow[] = checkups.map((c) => ({ ...c, findingItems: findingsByCheckup.get(c.id) ?? [] }));
  const { stats, form6 } = computeCheckupStats(list, items);

  return { officeInfo, rules, years, year, rounds, round, roundQuery, list, items, stats, form6 };
}
