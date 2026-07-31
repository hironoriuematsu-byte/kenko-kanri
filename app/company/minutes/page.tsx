import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/components/Header";
import MinutesTable from "@/components/MinutesTable";
import MinutesSettingsForm from "@/components/MinutesSettingsForm";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CompanyMinutesPage() {
  const { profile } = await requireProfile();
  if (profile.role !== "company" || !profile.company_id) redirect("/");

  const supabase = createClient();
  const [{ data: minutes }, { data: info }] = await Promise.all([
    supabase
      .from("hm_minutes")
      .select("id, meeting_date, title, published_to_employees")
      .eq("company_id", profile.company_id)
      .order("meeting_date", { ascending: false }),
    supabase
      .from("hm_company_info")
      .select("committee_name, default_attendees")
      .eq("company_id", profile.company_id)
      .maybeSingle(),
  ]);

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href="/company">← ダッシュボード</Link>
        </p>
        <h1 className="page-title">{info?.committee_name ?? "安全衛生委員会"}議事録</h1>
        <div className="card">
          <p>
            <Link className="btn orange" href="/company/minutes/new">
              ＋ 議事録を作成
            </Link>
          </p>
          <p className="muted">
            自社で作成した議事録ファイル（PDF・Word等）を登録する場合も「＋ 議事録を作成」から、
            開催日を入れてファイルを添付してください。
          </p>
          <MinutesTable minutes={minutes ?? []} />
        </div>

        <div className="card">
          <h2>議事録の設定</h2>
          <MinutesSettingsForm
            companyId={profile.company_id}
            initial={{
              committee_name: info?.committee_name ?? "",
              default_attendees: info?.default_attendees ?? "",
            }}
          />
        </div>
      </main>
    </>
  );
}
