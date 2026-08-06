import { createClient } from "@/lib/supabase/server";
import { DEFAULT_FACTORY_ITEMS, DEFAULT_OFFICE_ITEMS } from "@/lib/hygiene";

// 企業のチェックリスト項目を種別ごとに取得(未設定の種別は標準項目で補完)
export async function getChecklistItems(companyId: string): Promise<{
  itemsByType: Record<string, string[]>;
  configured: Record<string, boolean>;
}> {
  const supabase = createClient();
  const { data } = await supabase
    .from("hm_checklist_items")
    .select("checklist_type, item_text, sort_order")
    .eq("company_id", companyId)
    .order("sort_order");

  const factory = (data ?? [])
    .filter((r) => r.checklist_type === "factory")
    .map((r) => r.item_text);
  const office = (data ?? [])
    .filter((r) => r.checklist_type === "office")
    .map((r) => r.item_text);

  return {
    itemsByType: {
      factory: factory.length > 0 ? factory : DEFAULT_FACTORY_ITEMS,
      office: office.length > 0 ? office : DEFAULT_OFFICE_ITEMS,
    },
    configured: { factory: factory.length > 0, office: office.length > 0 },
  };
}
