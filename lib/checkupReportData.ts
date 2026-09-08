import { createClient } from "@/lib/supabase/server";
import type { ReportCheckup } from "@/components/CheckupReportPanel";
import type { ReportItem } from "@/lib/checkupReport";
import { fetchCheckupItems } from "@/lib/checkupItems";

// 報告書サマリ用に、年度内の健診結果と検査項目をまとめて取得する
export async function getCheckupReportData(companyId: string, year: number) {
  const supabase = createClient();
  const { data: checkups } = await supabase
    .from("hm_checkups")
    .select(
      "id, target_name, employee_no, birth_date, sex, checkup_type, checkup_date, overall_judgment, has_findings, work_judgment, work_judgment_date, work_judgment_note"
    )
    .eq("company_id", companyId)
    .eq("fiscal_year", year)
    .order("employee_no", { ascending: true, nullsFirst: false })
    .order("target_name");

  const ids = (checkups ?? []).map((c) => c.id);
  // 受診者が多いと項目は数千行になる。分割して全件取得する(集計漏れの防止)
  const items = await fetchCheckupItems(ids);

  return {
    checkups: (checkups as ReportCheckup[]) ?? [],
    items: items as ReportItem[],
  };
}
