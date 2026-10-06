import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveParticipants, meetApiConfigured } from "@/lib/googleMeet";

export const dynamic = "force-dynamic";

// 産業医事務所ダッシュボード用: 有効な面談ルームと、いま入室している人。officeのみ
export async function GET() {
  const supabase = createClient();
  const { data: isOffice } = await supabase.rpc("hm_is_office");
  if (!isOffice) return NextResponse.json({ error: "permission denied" }, { status: 403 });

  const { data: rooms } = await supabase
    .from("hm_meet_rooms")
    .select("company_id, space_name, companies(name)")
    .eq("enabled", true)
    .not("meeting_uri", "is", null);

  const configured = meetApiConfigured();
  type RoomRow = { company_id: string; space_name: string | null; companies: { name: string } | { name: string }[] | null };
  const items = await Promise.all(
    ((rooms ?? []) as unknown as RoomRow[]).map(async (r) => {
      let participants: { name: string; since: string | null }[] | null = null;
      if (configured && r.space_name) {
        try {
          participants = await getActiveParticipants(r.space_name);
        } catch {
          participants = null; // 取得できなかったルームは「不明」として表示する
        }
      }
      const company = Array.isArray(r.companies) ? r.companies[0] : r.companies;
      return {
        company_id: r.company_id,
        company_name: company?.name ?? "",
        participants,
      };
    })
  );
  items.sort((a, b) => a.company_name.localeCompare(b.company_name, "ja"));
  return NextResponse.json({ items });
}
