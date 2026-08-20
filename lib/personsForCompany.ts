import { createClient } from "@/lib/supabase/server";
import type { PersonCandidate } from "@/lib/personMatch";

// 健診の突合に使う、企業内のカルテ一覧
export async function getPersonCandidates(companyId: string): Promise<PersonCandidate[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("hm_persons")
    .select("id, full_name, employee_no, birth_date, user_id")
    .eq("company_id", companyId);
  return (data as PersonCandidate[]) ?? [];
}
