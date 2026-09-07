import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/components/Header";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateJa } from "@/lib/fiscal";
import { INTERVIEW_TYPES, formatDateTimeJa } from "@/lib/interviews";
import OfficeInfoForm from "@/components/OfficeInfoForm";
import { getOfficeInfo } from "@/lib/officeInfo";

export const dynamic = "force-dynamic";

export default async function OfficeDashboard() {
  const { profile } = await requireProfile();
  if (profile.role !== "office") redirect("/");

  const supabase = createClient();
  const [
    { data: companies },
    { data: interviews },
    { count: unjudgedCount },
    { count: heldCount },
  ] = await Promise.all([
      // 企業台帳はストレスチェックWebと共有している。健康管理Webも
      // ご契約いただいている企業(hm_enabled = true)だけを表示する。
      supabase
        .from("companies")
        .select("id, name")
        .eq("hm_enabled", true)
        .order("name"),
      supabase
        .from("hm_interviews")
        .select("id, target_name, interview_type, scheduled_at, status, companies(name)")
        .eq("status", "scheduled")
        .order("scheduled_at", { ascending: true, nullsFirst: false })
        .limit(15),
      supabase
        .from("hm_checkups")
        .select("id", { count: "exact", head: true })
        .is("work_judgment", null),
      supabase
        .from("hm_checkups")
        .select("id", { count: "exact", head: true })
        .eq("work_judgment", "pending"),
    ]);

  const officeInfo = await getOfficeInfo();
  // ストレスチェックWebへの導線は、URLが設定されているときだけ表示する
  const stressUrl = process.env.NEXT_PUBLIC_STRESS_URL;
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

        {(overdue.length > 0 || (unjudgedCount ?? 0) > 0 || (heldCount ?? 0) > 0) && (
          <div className="card" style={{ borderColor: "var(--orange)" }}>
            <h2>未対応タスク</h2>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {(unjudgedCount ?? 0) > 0 && (
                <li>
                  就業判定が未入力: <strong>{unjudgedCount}名</strong>
                </li>
              )}
              {(heldCount ?? 0) > 0 && (
                <li>
                  就業判定が「判定保留」: <strong>{heldCount}名</strong>
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
                  <th>予定日</th>
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
          <h2>事務所の設定</h2>
          <p>
            <Link className="btn secondary" href="/office/judgment-criteria">
              健診結果の判定基準（A〜D）を設定する
            </Link>
          </p>
          <p className="muted">
            以下は帳票・CSV（定期健康診断結果報告書など）に記載されます。
          </p>
          <OfficeInfoForm initial={officeInfo} />
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
              健康管理Webをご利用いただく企業がありません。ストレスチェックWebの
              「企業管理」で、対象の企業の「健康管理Web 併用する」にチェックを入れると
              ここに表示されます。
            </p>
          )}

          {/* 企業台帳はストレスチェックWebと共有しているため、登録はあちらに一本化している */}
          {stressUrl && (
            <p className="muted" style={{ marginTop: 14 }}>
              企業の追加・名称変更、ご担当者の招待は{" "}
              <a href={`${stressUrl}/office`} target="_blank" rel="noopener noreferrer">
                ストレスチェックWeb ↗
              </a>{" "}
              の「企業管理」「ユーザー管理」で行えます。ログインは共有しているため、
              そのままご利用いただけます。健康管理Webのみをご利用の企業も、同じ手順で登録できます。
            </p>
          )}
        </div>
      </main>
    </>
  );
}
