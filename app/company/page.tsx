import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/components/Header";
import MinutesTable from "@/components/MinutesTable";
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
  const [{ data: company }, { data: minutes }] = await Promise.all([
    supabase.from("companies").select("id, name").eq("id", profile.company_id).single(),
    supabase
      .from("hm_minutes")
      .select("id, meeting_date, title, physician_attended, published_to_employees, next_meeting_date")
      .eq("company_id", profile.company_id)
      .order("meeting_date", { ascending: false }),
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
          <h2>今後追加予定の機能</h2>
          <p className="muted">
            健康診断結果・事後措置・面談予定は次のフェーズで追加されます。
          </p>
        </div>
      </main>
    </>
  );
}
