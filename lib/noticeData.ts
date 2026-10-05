import { createClient } from "@/lib/supabase/server";

// 受診勧奨通知書の差出人欄に記載する企業の所在地
export async function getCompanyAddress(companyId: string): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("hm_company_info")
    .select("address")
    .eq("company_id", companyId)
    .maybeSingle();
  return (data?.address as string | null) ?? null;
}
