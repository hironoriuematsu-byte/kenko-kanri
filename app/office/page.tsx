import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/components/Header";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateJa } from "@/lib/fiscal";
import { INTERVIEW_TYPES, formatDateTimeJa } from "@/lib/interviews";

export const dynamic = "force-dynamic";

export default async function OfficeDashboard() {
  const { profile } = await requireProfile();
  if (profile.role !== "office") redirect("/");

  const supabase = createClient();
  const [
    { data: companies },
    { data: interviews },
    { count: unjudgedCount },
    { count: followupPendingCount },
  ] = await Promise.all([
      supabase.from("companies").select("id, name").order("name"),
      supabase
        .from("hm_interviews")
        .select("id, target_name, interview_type, scheduled_at, status, companies(name)")
        .eq("status", "scheduled")
        .order("scheduled_at", { ascending: true, nullsFirst: false })
        .limit(15),
      supabase
        .from("hm_checkups")
        .select("id", { count: "exact", head: true })
        .eq("has_findings", true)
        .is("work_judgment", null),
      supabase
        .from("hm_checkups")
        .select("id", { count: "exact", head: true })
        .eq("followup_status", "pending"),
    ]);

  const today = new Date();
  const overdue = (interviews ?? []).filter(
    (i: any) => i.scheduled_at && new Date(i.scheduled_at) < today
  );
  const upcomingInterviews = (interviews ?? []).filter(
    (i: any) => !i.scheduled_at || new Date(i.scheduled_at) >= today
  );

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <h1 className="page-title">産業医事務所ダッシュボード</h1>

        {(overdue.length > 0 || (unjudgedCount ?? 0) > 0 || (followupPendingCount ?? 0) > 0) && (
          <div className="card" style={{ borderColor: "var(--orange)" }}>
            <h2>未対応タスク</h2>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {(unjudgedCount ?? 0) > 0 && (
                <li>
                  就業判定が未入力の有所見者: <strong>{unjudgedCount}名</strong>
                </li>
              )}
              {(followupPendingCount ?? 0) > 0 && (
                <li>
                  事後措置が未対応: <strong>{followupPendingCount}名</strong>
                </li>
              )}
              {overdue.length > 0 && (
                <li>
                  予定日を過ぎて未実施の面談: <strong>{overdue.length}件</strong>
                </li>
              )}
            </ul>
          </div>
        )}

        <div className="card">
          <h2>面談予定</h2>
          {(interviews ?? []).length > 0 ? (
            <table className="list">
              <thead>
                <tr>
                  <th>予定日時</th>
                  <th>企業</th>
                  <th>対象者</th>
                  <th>種別</th>
                </tr>
              </thead>
              <tbody>
                {[...overdue, ...upcomingInterviews].map((i: any) => (
                  <tr key={i.id}>
                    <td>
                      <Link href={`/interviews/${i.id}`}>
                        {formatDateTimeJa(i.scheduled_at)}
                      </Link>
                      {overdue.includes(i) && (
                        <span className="badge orange" style={{ marginLeft: 6 }}>
                          未実施
                        </span>
                      )}
                    </td>
                    <td>{i.companies?.name ?? "—"}</td>
                    <td>{i.target_name}</td>
                    <td>{INTERVIEW_TYPES[i.interview_type] ?? i.interview_type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">予定されている面談はありません。</p>
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
