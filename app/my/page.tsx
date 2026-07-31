import { redirect } from "next/navigation";
import Header from "@/components/Header";
import MinutesTable from "@/components/MinutesTable";
import InterviewsTable from "@/components/InterviewsTable";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function MyPage() {
  const { profile } = await requireProfile();
  if (profile.role !== "employee") redirect("/");

  const supabase = createClient();
  const [{ data: minutes }, { data: interviews }, { data: checkups }] = await Promise.all([
    supabase
      .from("hm_minutes")
      .select("id, meeting_date, title, published_to_employees")
      .order("meeting_date", { ascending: false }),
    supabase
      .from("hm_interviews")
      .select("id, target_name, interview_type, scheduled_at, method, status")
      .order("scheduled_at", { ascending: false, nullsFirst: false }),
    supabase
      .from("hm_checkups")
      .select("id, fiscal_year, checkup_type, checkup_date, overall_judgment")
      .order("fiscal_year", { ascending: false }),
  ]);

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <h1 className="page-title">マイページ</h1>

        <div className="card">
          <h2>公開された安全衛生委員会 議事録</h2>
          <MinutesTable minutes={minutes ?? []} />
        </div>

        <div className="card">
          <h2>ご自身の面談予定</h2>
          <InterviewsTable interviews={interviews ?? []} showTarget={false} />
        </div>

        <div className="card">
          <h2>ご自身の健康診断結果</h2>
          {(checkups ?? []).length > 0 ? (
            <table className="list">
              <thead>
                <tr>
                  <th>年度</th>
                  <th>健診日</th>
                  <th>総合判定</th>
                </tr>
              </thead>
              <tbody>
                {(checkups ?? []).map((c: any) => (
                  <tr key={c.id}>
                    <td>
                      <a href={`/checkup/${c.id}`}>{c.fiscal_year}年度</a>
                    </td>
                    <td>{c.checkup_date ?? "—"}</td>
                    <td>{c.overall_judgment ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">
              健診結果はまだ登録されていません（アカウントに紐付けられた結果のみ表示されます）。
            </p>
          )}
        </div>
      </main>
    </>
  );
}
