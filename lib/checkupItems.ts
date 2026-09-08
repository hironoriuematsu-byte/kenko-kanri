import { createClient } from "@/lib/supabase/server";

export type CheckupItemRow = {
  checkup_id: string;
  item_name: string;
  value: string | null;
  judgment: string | null;
  sort_order: number;
};

// 1回のリクエストで返る行数には上限(既定1000行)があり、URLの長さにも制限がある。
// 受診者が多いと検査項目は数千行になるため、対象を分けて全件を取得する。
export async function fetchCheckupItems(checkupIds: string[]): Promise<CheckupItemRow[]> {
  if (checkupIds.length === 0) return [];
  const supabase = createClient();
  const IDS_PER_REQUEST = 100; // URLが長くなりすぎないように分ける
  const PAGE = 1000; // 1回に取得する行数
  const all: CheckupItemRow[] = [];

  for (let i = 0; i < checkupIds.length; i += IDS_PER_REQUEST) {
    const ids = checkupIds.slice(i, i + IDS_PER_REQUEST);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("hm_checkup_items")
        .select("checkup_id, item_name, value, judgment, sort_order")
        .in("checkup_id", ids)
        .order("checkup_id")
        .order("sort_order")
        .range(from, from + PAGE - 1);
      if (error || !data || data.length === 0) break;
      all.push(...(data as CheckupItemRow[]));
      if (data.length < PAGE) break;
    }
  }
  return all;
}
