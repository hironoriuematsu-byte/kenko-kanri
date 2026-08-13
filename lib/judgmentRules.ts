import { createClient } from "@/lib/supabase/server";
import type { JudgmentRule } from "@/lib/judgment";

export async function getJudgmentRules(): Promise<JudgmentRule[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("hm_judgment_rules")
    .select("id, item_key, item_label, unit, sex, grade, min_value, max_value, match_text, sort_order")
    .order("item_key")
    .order("sort_order");
  return (data as JudgmentRule[]) ?? [];
}
