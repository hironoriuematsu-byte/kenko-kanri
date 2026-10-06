import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createSpace,
  getActiveParticipants,
  listConferences,
  meetApiConfigured,
} from "@/lib/googleMeet";

export const dynamic = "force-dynamic";

// 面談ルームの在室状況と開催履歴。ルームが見える人(office / 自社のcompany)だけが取得できる
// (hm_meet_rooms の RLS で判定するため、他社のルームは見つからない扱いになる)
export async function GET(_req: Request, { params }: { params: { companyId: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const { data: room } = await supabase
    .from("hm_meet_rooms")
    .select("space_name")
    .eq("company_id", params.companyId)
    .maybeSingle();
  if (!room) return NextResponse.json({ error: "not found" }, { status: 404 });

  // 手入力のリンクで登録したルームは、Meet API から在室状況を取得できない
  if (!room.space_name || !meetApiConfigured()) {
    return NextResponse.json({ supported: false });
  }

  try {
    const [participants, history] = await Promise.all([
      getActiveParticipants(room.space_name),
      listConferences(room.space_name, 10),
    ]);
    return NextResponse.json({ supported: true, participants, history });
  } catch (e) {
    return NextResponse.json({
      supported: true,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// 面談ルームを Google Meet に作成(または作り直し)して保存する。officeのみ
export async function POST(_req: Request, { params }: { params: { companyId: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const { data: isOffice } = await supabase.rpc("hm_is_office");
  if (!isOffice) return NextResponse.json({ error: "permission denied" }, { status: 403 });
  if (!meetApiConfigured()) {
    return NextResponse.json(
      { error: "Google Meet API の環境変数が設定されていません" },
      { status: 400 }
    );
  }

  let space;
  try {
    space = await createSpace();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }

  const { error } = await supabase.from("hm_meet_rooms").upsert(
    {
      company_id: params.companyId,
      enabled: true,
      meeting_uri: space.meetingUri,
      meeting_code: space.meetingCode,
      space_name: space.name,
      created_by: user.id,
    },
    { onConflict: "company_id" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.rpc("hm_log_access", {
    p_action: "meet_room_create",
    p_target_table: "hm_meet_rooms",
    p_target_id: params.companyId,
    p_detail: { meeting_code: space.meetingCode },
  });
  return NextResponse.json({ meetingUri: space.meetingUri, meetingCode: space.meetingCode });
}
