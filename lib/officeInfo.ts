import { createClient } from "@/lib/supabase/server";
import type { OfficeInfo } from "@/components/CheckupReportPanel";

// 帳票・CSVに記載する産業医事務所の情報(1行のみ)
export async function getOfficeInfo(): Promise<OfficeInfo | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("hm_office_info")
    .select("office_name, address, tel, physician_name")
    .eq("id", "default")
    .maybeSingle();
  return (data as OfficeInfo) ?? null;
}
