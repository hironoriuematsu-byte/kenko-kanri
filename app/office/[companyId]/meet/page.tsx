import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import MeetRoomPanel from "@/components/MeetRoomPanel";
import MeetRoomSettings from "@/components/MeetRoomSettings";
import { requireProfile } from "@/lib/auth";
import { meetApiConfigured } from "@/lib/googleMeet";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// 産業医面談ルーム(実施者向け: 入室・在室状況・入室記録・ルームの設定)
export default async function OfficeMeetPage({ params }: { params: { companyId: string } }) {
  const { profile } = await requireProfile();
  if (profile.role !== "office") redirect("/");

  const supabase = createClient();
  const [{ data: company }, { data: room }, { data: entries }] = await Promise.all([
    supabase.from("companies").select("id, name").eq("id", params.companyId).single(),
    supabase
      .from("hm_meet_rooms")
      .select("enabled, meeting_uri, meeting_code, space_name, note")
      .eq("company_id", params.companyId)
      .maybeSingle(),
    supabase
      .from("hm_meet_entries")
      .select("user_name, role, entered_at")
      .eq("company_id", params.companyId)
      .order("entered_at", { ascending: false })
      .limit(20),
  ]);
  if (!company) notFound();

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href={`/office/${company.id}`}>← {company.name}</Link>
        </p>
        <h1 className="page-title">産業医面談ルーム（{company.name}）</h1>

        {room?.meeting_uri && (
          <MeetRoomPanel
            companyId={company.id}
            note={room.note}
            entries={entries ?? []}
            viewer="office"
          />
        )}
        <MeetRoomSettings companyId={company.id} room={room} apiConfigured={meetApiConfigured()} />
      </main>
    </>
  );
}
