import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/components/Header";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateJa } from "@/lib/fiscal";

export const dynamic = "force-dynamic";

export default async function OfficeDashboard() {
  const { profile } = await requireProfile();
  if (profile.role !== "office") redirect("/");

  const supabase = createClient();
  const [{ data: companies }, { data: upcoming }] = await Promise.all([
    supabase.from("companies").select("id, name").order("name"),
    supabase
      .from("hm_minutes")
      .select("id, company_id, meeting_date, next_meeting_date, title, companies(name)")
      .gte("next_meeting_date", new Date().toISOString().slice(0, 10))
      .order("next_meeting_date", { ascending: true })
      .limit(10),
  ]);

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <h1 className="page-title">産業医事務所ダッシュボード</h1>

        <div className="card">
          <h2>次回の安全衛生委員会</h2>
          {upcoming && upcoming.length > 0 ? (
            <table className="list">
              <thead>
                <tr>
                  <th>企業</th>
                  <th>次回予定日</th>
                  <th>前回議事録</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((m: any) => (
                  <tr key={m.id}>
                    <td>{m.companies?.name ?? "—"}</td>
                    <td>{formatDateJa(m.next_meeting_date)}</td>
                    <td>
                      <Link href={`/minutes/${m.id}`}>{formatDateJa(m.meeting_date)} の議事録</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">直近の委員会予定はありません。</p>
          )}
        </div>

        <div className="card">
          <h2>企業一覧</h2>
          {companies && companies.length > 0 ? (
            <div className="card-grid">
              {companies.map((c) => (
                <Link
                  key={c.id}
                  href={`/office/${c.id}`}
                  className="card"
                  style={{ marginBottom: 0 }}
                >
                  <strong>{c.name}</strong>
                  <div className="muted">議事録・健診・面談の管理へ</div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="muted">
              企業が登録されていません。開発用DBの場合は 0000_dev_base.sql
              のコメントに沿ってテストデータを作成してください。
            </p>
          )}
        </div>
      </main>
    </>
  );
}
