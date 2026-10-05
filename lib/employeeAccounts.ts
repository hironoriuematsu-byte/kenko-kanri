import { createClient } from "@/lib/supabase/server";
import type { EmployeeAccount } from "@/lib/accountMatch";

// 企業の従業員アカウント(profiles, role=employee)の一覧。カルテの紐付け候補に使う。
// ストレスチェックWeb側の 0024(birth_date)が未実行の環境では生年月日なしで返す
export async function getEmployeeAccounts(companyId: string): Promise<EmployeeAccount[]> {
  const supabase = createClient();
  const base = supabase.from("profiles").select("id, full_name, employee_no, birth_date").eq("company_id", companyId).eq("role", "employee").order("full_name");
  const { data, error } = await base;
  if (!error) return (data as EmployeeAccount[]) ?? [];
  const { data: fallback } = await supabase
    .from("profiles")
    .select("id, full_name, employee_no")
    .eq("company_id", companyId)
    .eq("role", "employee")
    .order("full_name");
  return (fallback as EmployeeAccount[]) ?? [];
}
