import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/components/Header";
import MinutesTable from "@/components/MinutesTable";
import InterviewsTable from "@/components/InterviewsTable";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateJa } from "@/lib/fiscal";

export const dynamic = "force-dynamic";

export default async function CompanyDashboard() {
  const { profile } = await requireProfile();
  if (profile.role !== "company") redirect("/");
  if (!profile.company_id) {
    return (
      <>
        <Header profile={profile} />
        <main className="container">
          <div className="notice">
            所属企業が設定されていません。産業医事務所にお問い合わせください。
          </div>
        </main>
      </>
    );
  }

  const supabase = createClient();
  const [
    { data: company },
    { data: minutes },
    { data: interviews },
    { count: followupPending },
    { count: followupRecommended },
  ] = await Promise.all([
    supabase.from("companies").select("id, name").eq("id", profile.company_id).single(),
    supabase
      .from("hm_minutes")
      .select("id, meeting_date, title, physician_attended, published_to_employees, next_meeting_date")
      .eq("company_id", profile.company_id)
      .order("meeting_date", { ascending: false }),
    supabase
      .from("hm_interviews")
      .select("id, target_name, interview_type, scheduled_at, method, status")
      .eq("company_id", profile.company_id)
      .order("scheduled_at", { ascending: false, nullsFirst: false }),
    supabase
      .from("hm_checkups")
      .select("id", { count: "exact", head: true })
      .eq("company_id", profile.company_id)
      .eq("followup_status", "pending"),
    supabase
      .from("hm_checkups")
      .select("id", { count: "exact", head: true })
      .eq("company_id", profile.company_id)
      .eq("followup_status", "recommended"),
  ]);

  const next = (minutes ?? [])
    .filter((m) => m.next_meeting_date && m.next_meeting_date >= new Date().toISOString().slice(0, 10))
    .sort((a, b) => (a.next_meeting_date! < b.next_meeting_date! ? -1 : 1))[0];

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <h1 className="page-title">{company?.name ?? "自社"} ダッシュボード</h1>

        {next && (
          <div className="notice">
            次回の安全衛生委員会: <strong>{formatDateJa(next.next_meeting_date)}</strong>
          </div>
        )}

        <div className="card">
          <h2>安全衛生委員会 議事録</h2>
          <p>
            <Link className="btn orange" href="/company/minutes/new">
              ＋ 議事録を作成
            </Link>
          </p>
          <MinutesTable minutes={minutes ?? []} />
        </div>

        <div className="card">
          <h2>面談予定</h2>
          <InterviewsTable interviews={interviews ?? []} />
          <p className="muted" style={{ marginTop: 10 }}>
            日程の調整は各面談の詳細画面から行えます。産業医の意見書は公開され次第、詳細画面に表示されます。
          </p>
        </div>

        <div className="card">
          <h2>健康診断</h2>
          {((followupPending ?? 0) > 0 || (followupRecommended ?? 0) > 0) && (
            <p>
              有所見者フォロー状況: 未対応{" "}
              <span className="badge orange">{followupPending ?? 0}名</span>
              {"　"}勧奨済 <span className="badge">{followupRecommended ?? 0}名</span>
            </p>
          )}
          <p>
            <Link className="btn" href="/company/checkups">
              健診結果の管理へ（取込・有所見・事後措置）
            </Link>
          </p>
        </div>
      </main>
    </>
  );
}
