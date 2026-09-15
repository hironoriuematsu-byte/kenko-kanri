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
// 分けたまとまりは同時に取りに行き、待ち時間を短くする。
export async function fetchCheckupItems(checkupIds: string[]): Promise<CheckupItemRow[]> {
  if (checkupIds.length === 0) return [];
  const supabase = createClient();
  const IDS_PER_REQUEST = 100; // URLが長くなりすぎないように分ける
  const PAGE = 1000; // 1回に取得する行数

  const fetchChunk = async (ids: string[]): Promise<CheckupItemRow[]> => {
    const rows: CheckupItemRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("hm_checkup_items")
        .select("checkup_id, item_name, value, judgment, sort_order")
        .in("checkup_id", ids)
        .order("checkup_id")
        .order("sort_order")
        .range(from, from + PAGE - 1);
      if (error || !data || data.length === 0) break;
      rows.push(...(data as CheckupItemRow[]));
      if (data.length < PAGE) break;
    }
    return rows;
  };

  const chunks: string[][] = [];
  for (let i = 0; i < checkupIds.length; i += IDS_PER_REQUEST) {
    chunks.push(checkupIds.slice(i, i + IDS_PER_REQUEST));
  }
  const results = await Promise.all(chunks.map(fetchChunk));
  return results.flat();
}
