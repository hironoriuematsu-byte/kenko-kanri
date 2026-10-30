import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import IkenReturnButton from "@/components/IkenReturnButton";
import { businessDaysLeft, formatMdW, returnDueDate } from "@/lib/businessDays";
import { currentFiscalYearJst, formatYen, SERVICE_NAME } from "@/lib/iken";

type OpenJob = { id: string; company_id: string; company_name: string; file_name: string | null; received_at: string; upload_status: string | null };

// 実施者: 健診結果の医師意見聴取Web の未返却の受付(返却期限の近い順)と、最近のお申込み
export default async function IkenJobsPanel() {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("hm_iken_open_jobs");
  if (error) return null; // SQL 0152 が未実行の環境では出さない
  const jobs = (data as OpenJob[] | null) ?? [];

  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data: orders } = await supabase
    .from("hm_iken_orders")
    .select("id, kind, fiscal_year, seats, seats_granted, amount, company_name, paid_at")
    .eq("status", "paid")
    .gte("paid_at", since)
    .order("paid_at", { ascending: false })
    .limit(10);

  // 事業場ごとにまとめる(期限は最も早い受付で決まる)
  const byCompany = new Map<string, { name: string; jobs: (OpenJob & { due: string })[] }>();
  for (const j of jobs) {
    const g = byCompany.get(j.company_id) ?? { name: j.company_name, jobs: [] };
    g.jobs.push({ ...j, due: returnDueDate(new Date(j.received_at)) });
    byCompany.set(j.company_id, g);
  }
  const groups = Array.from(byCompany.entries())
    .map(([companyId, g]) => ({ companyId, ...g, due: g.jobs.map((x) => x.due).sort()[0] }))
    .sort((a, b) => (a.due < b.due ? -1 : 1));

  // 各事業場の未判定(未入力・判定保留)の人数と、件数枠
  const fy = currentFiscalYearJst();
  const extra = await Promise.all(
    groups.map(async (g) => {
      const [{ count }, { data: st }] = await Promise.all([
        supabase
          .from("hm_checkups")
          .select("id", { count: "exact", head: true })
          .eq("company_id", g.companyId)
          .or("work_judgment.is.null,work_judgment.eq.pending"),
        supabase.rpc("hm_iken_status", { p_company_id: g.companyId, p_fiscal_year: fy }),
      ]);
      const s = ((st as { seats: number; used: number }[] | null) ?? [])[0] ?? { seats: 0, used: 0 };
      return { unjudged: count ?? 0, ...s };
    })
  );

  if (groups.length === 0 && (orders ?? []).length === 0) return null;

  return (
    <div className="card" style={{ borderColor: groups.length > 0 ? "var(--orange)" : undefined }}>
      <h2>{SERVICE_NAME}(50人未満・Web申込)</h2>
      {groups.length === 0 ? (
        <p className="muted" style={{ marginTop: 0 }}>未返却の健診結果はありません。</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="list">
            <thead>
              <tr>
                <th>返却期限</th>
                <th>事業場</th>
                <th>受付</th>
                <th>未判定</th>
                <th>件数(使用/申込)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g, i) => {
                const left = businessDaysLeft(g.due);
                const pendingImport = g.jobs.filter((j) => j.upload_status === "pending").length;
                return (
                  <tr key={g.companyId}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <strong style={{ color: left <= 0 ? "var(--danger)" : left === 1 ? "var(--orange)" : undefined }}>
                        {formatMdW(g.due)}
                      </strong>
                      <div className="muted">{left < 0 ? `${-left}営業日超過` : left === 0 ? "本日まで" : `あと${left}営業日`}</div>
                    </td>
                    <td>
                      <Link href={`/office/${g.companyId}/checkups`}>{g.name}</Link>
                    </td>
                    <td>
                      {g.jobs.length}ファイル
                      {pendingImport > 0 && <div className="muted">うち取込待ち {pendingImport}</div>}
                    </td>
                    <td>{extra[i].unjudged > 0 ? <span className="badge orange">{extra[i].unjudged}名</span> : "0名"}</td>
                    <td style={{ color: extra[i].used > extra[i].seats ? "var(--danger)" : undefined }}>
                      {extra[i].used}/{extra[i].seats}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <IkenReturnButton companyId={g.companyId} companyName={g.name} unjudged={extra[i].unjudged} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted" style={{ marginBottom: 0 }}>
        取込 → 一括判定 → 確認が済んだら「返却してメール」で担当者に知らせます(メールに個人の健康情報は書きません)。
        期限は受付(17時以降・休業日は翌営業日)から3営業日です。
      </p>
      {(orders ?? []).length > 0 && (
        <>
          <h3 style={{ fontSize: 14, margin: "14px 0 6px" }}>最近のお申込み(14日間)</h3>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14 }}>
            {(orders as { id: string; kind: string; fiscal_year: number; seats: number; seats_granted: number; amount: number; company_name: string; paid_at: string }[]).map((o) => (
              <li key={o.id}>
                {o.paid_at.slice(0, 10)} {o.company_name} {o.fiscal_year}年度{" "}
                {o.kind === "new" ? `申込 ${o.seats_granted}件` : `追加 ${o.seats}件`} {formatYen(o.amount)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
