import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/components/Header";
import MeetRoomPanel from "@/components/MeetRoomPanel";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// 産業医面談ルーム(企業担当者向け: 入室・在室状況・入室記録)
export default async function CompanyMeetPage() {
  const { profile } = await requireProfile();
  if (profile.role !== "company" || !profile.company_id) redirect("/");

  const supabase = createClient();
  const [{ data: room }, { data: entries }] = await Promise.all([
    // RLS により、自社の有効なルームだけが読める
    supabase
      .from("hm_meet_rooms")
      .select("meeting_uri, note")
      .eq("company_id", profile.company_id)
      .maybeSingle(),
    supabase
      .from("hm_meet_entries")
      .select("user_name, role, entered_at")
      .eq("company_id", profile.company_id)
      .order("entered_at", { ascending: false })
      .limit(20),
  ]);
  if (!room?.meeting_uri) redirect("/company");

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href="/company">← ダッシュボード</Link>
        </p>
        <h1 className="page-title">産業医面談ルーム</h1>
        <MeetRoomPanel
          companyId={profile.company_id}
          note={room.note}
          entries={entries ?? []}
          viewer="company"
        />
      </main>
    </>
  );
}
