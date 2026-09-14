import { createClient } from "@/lib/supabase/server";
import type { ReportCheckup } from "@/components/CheckupReportPanel";
import type { ReportItem } from "@/lib/checkupReport";
import { fetchCheckupItems } from "@/lib/checkupItems";

// 報告書サマリ用に、年度内の健診結果と検査項目をまとめて取得する
export async function getCheckupReportData(companyId: string, year: number, round?: number) {
  const supabase = createClient();
  let query = supabase
    .from("hm_checkups")
    .select(
      "id, target_name, employee_no, birth_date, sex, checkup_type, special_kind, checkup_date, overall_judgment, has_findings, work_judgment, work_judgment_date, work_judgment_note, followup_status"
    )
    .eq("company_id", companyId)
    .eq("fiscal_year", year)
    .order("employee_no", { ascending: true, nullsFirst: false })
    .order("target_name");
  // 年に複数回の定期健診がある事業場では、実施回ごとに報告書を出す
  if (round) query = query.eq("round", round);
  const { data: checkups } = await query;

  const ids = (checkups ?? []).map((c) => c.id);
  // 受診者が多いと項目は数千行になる。分割して全件取得する(集計漏れの防止)
  const items = await fetchCheckupItems(ids);

  return {
    checkups: (checkups as ReportCheckup[]) ?? [],
    items: items as ReportItem[],
  };
}
