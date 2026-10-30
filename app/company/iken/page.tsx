import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/components/Header";
import IkenOrderForm from "@/components/IkenOrderForm";
import IkenWorkInfoForm from "@/components/IkenWorkInfoForm";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadIkenState } from "@/lib/ikenData";
import { formatYen, orderableYears, SERVICE_NAME } from "@/lib/iken";
import { formatMdW, IKEN_RETURN_DAYS } from "@/lib/businessDays";
import { stripeConfigured } from "@/lib/stripe";

export const dynamic = "force-dynamic";

const jstDateTime = (ts: string) => {
  const d = new Date(new Date(ts).getTime() + 9 * 3600 * 1000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

// 事業者担当者: 健診結果の医師意見聴取Web のお申込み・件数・受付状況
export default async function CompanyIkenPage({ searchParams }: { searchParams: { paid?: string; canceled?: string } }) {
  const { profile } = await requireProfile();
  if (profile.role !== "company" || !profile.company_id) redirect("/");
  const supabase = createClient();
  const state = await loadIkenState(supabase, profile.company_id);
  if (!state) redirect("/company");

  const years = orderableYears();
  const { data: plans } = await supabase
    .from("hm_iken_plans")
    .select("fiscal_year, seats")
    .eq("company_id", profile.company_id)
    .in("fiscal_year", years);
  const seatsByYear: Record<number, number> = {};
  for (const p of (plans as { fiscal_year: number; seats: number }[] | null) ?? []) seatsByYear[p.fiscal_year] = p.seats;

  const over = state.used - state.seats;
  const openJobs = state.jobs.filter((j) => !j.returned_at);

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href="/company">← ダッシュボード</Link>
        </p>
        <h1 className="page-title">医師意見聴取のお申込み</h1>

        {searchParams.paid && (
          <div className="notice" style={{ background: "var(--teal-light)", borderColor: "var(--teal)" }}>
            お支払いありがとうございます。確認が済むと件数に反映されます(反映まで1分ほどかかることがあります。表示されない場合はページを再読み込みしてください)。
          </div>
        )}
        {searchParams.canceled && <div className="notice">お支払いは完了していません。もう一度お申し込みいただけます。</div>}

        <div className="card">
          <h2>{state.fiscalYear}年度の件数</h2>
          {state.seats > 0 ? (
            <>
              <p style={{ fontSize: 18, margin: "0 0 6px" }}>
                ご利用 <strong>{state.used}</strong>件 / お申込み <strong>{state.seats}</strong>件
                <span className="muted">(残り {Math.max(0, state.seats - state.used)}件)</span>
              </p>
              {over > 0 && (
                <div className="notice">
                  お申込みの件数を {over}件 超えています。下の「件数を追加」から {over}件分を追加してください。
                </div>
              )}
              <p style={{ margin: "8px 0 0" }}>
                <Link href="/company/checkups/import" className="btn">
                  健診結果を送る(CSV・PDF)
                </Link>
              </p>
            </>
          ) : (
            <p style={{ margin: 0 }}>
              {state.fiscalYear}年度はまだお申し込みいただいていません。件数を入力してお支払いいただくと、健診結果を送れるようになります。
            </p>
          )}
        </div>

        <div className="card">
          <h2>{state.seats > 0 ? "件数を追加" : "お申し込み"}</h2>
          {stripeConfigured() ? (
            <IkenOrderForm years={years} seatsByYear={seatsByYear} defaultSeats={state.seats > 0 ? Math.max(1, over) : Math.max(1, state.info.workers ?? 10)} />
          ) : (
            <p className="muted" style={{ margin: 0 }}>現在、Webでのお申込みは準備中です。support@mestate.jp までお問い合わせください。</p>
          )}
        </div>

        <div className="card">
          <h2>健診結果の受付状況</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            受け付けた日から{IKEN_RETURN_DAYS}営業日以内に、産業医が就業判定と意見を入力してメールでお知らせします
            (営業日の17時以降・休業日に届いたものは次の営業日の受付)。
          </p>
          {state.jobs.length === 0 ? (
            <p style={{ margin: 0 }}>まだ健診結果は届いていません。</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="list">
                <thead>
                  <tr>
                    <th>送信日時</th>
                    <th>ファイル</th>
                    <th>返却期限</th>
                    <th>状況</th>
                  </tr>
                </thead>
                <tbody>
                  {state.jobs.map((j) => (
                    <tr key={j.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{jstDateTime(j.received_at)}</td>
                      <td>{j.file_name ?? "—"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{formatMdW(j.due)}まで</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {j.returned_at ? (
                          <span className="badge">返却済み {jstDateTime(j.returned_at)}</span>
                        ) : (
                          <span className="badge orange">判定中</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {openJobs.length === 0 && state.jobs.length > 0 && (
            <p style={{ margin: "8px 0 0" }}>
              結果は <Link href="/company/checkups">健康診断管理</Link> で確認できます。
            </p>
          )}
        </div>

        <div className="card">
          <h2>主な業務内容・勤務形態</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            医師が就業上の意見を述べるための情報です(労働時間・深夜業・運転業務・有害業務の有無など)。個別にお伝えしたいことは、健診結果を送るときの連絡欄にご記入ください。
          </p>
          <IkenWorkInfoForm companyId={profile.company_id} initial={state.info.work_info ?? ""} readOnly={profile.view_only} />
        </div>

        <div className="card">
          <h2>お支払いの記録</h2>
          {state.orders.length === 0 ? (
            <p style={{ margin: 0 }}>まだお支払いはありません。</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="list">
                <thead>
                  <tr>
                    <th>お申込み日</th>
                    <th>年度</th>
                    <th>内容</th>
                    <th>金額(税込)</th>
                    <th>領収書</th>
                  </tr>
                </thead>
                <tbody>
                  {state.orders.map((o) => (
                    <tr key={o.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{jstDateTime(o.created_at)}</td>
                      <td>{o.fiscal_year}年度</td>
                      <td>{o.kind === "new" ? `年度のお申込み(${o.seats_granted}件まで)` : `件数の追加(${o.seats}件)`}</td>
                      <td>{formatYen(o.amount)}</td>
                      <td>
                        {o.status === "paid" ? (
                          <a href={`/api/iken/receipt?id=${o.id}`} target="_blank" rel="noopener noreferrer">
                            領収書
                          </a>
                        ) : (
                          <span className="muted">お支払い待ち</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <p className="muted">
          {SERVICE_NAME}の <Link href="/iken/terms">利用規約</Link> / <Link href="/iken/tokushoho">特定商取引法に基づく表記</Link>
        </p>
      </main>
    </>
  );
}
