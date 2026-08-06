import Link from "next/link";
import { notFound } from "next/navigation";
import Header from "@/components/Header";
import PrintButton from "@/components/PrintButton";
import DeleteHygienePatrolButton from "@/components/DeleteHygienePatrolButton";
import { requireProfile, homePathFor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateJa } from "@/lib/fiscal";
import { CHECKLIST_TYPES, RESULT_LABELS, type ChecklistResult } from "@/lib/hygiene";

export const dynamic = "force-dynamic";

// 衛生管理者巡視記録の詳細(チェックリスト・印刷様式)
export default async function HygienePatrolDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { profile } = await requireProfile();
  const supabase = createClient();

  const { data: p } = await supabase
    .from("hm_hygiene_patrols")
    .select(
      "id, company_id, patrol_date, checklist_type, inspector_name, results, summary, companies(name)"
    )
    .eq("id", params.id)
    .single();
  if (!p) notFound();

  await supabase.rpc("hm_log_access", {
    p_action: "view",
    p_target_table: "hm_hygiene_patrols",
    p_target_id: p.id,
  });

  const isOffice = profile.role === "office";
  const isCompany = profile.role === "company" && profile.company_id === p.company_id;
  const companyName = (p as any).companies?.name ?? "";
  const backHref = isOffice
    ? `/office/${p.company_id}/hygiene-patrols`
    : "/company/hygiene-patrols";
  const results = (p.results as ChecklistResult[]) ?? [];
  const ngCount = results.filter((r) => r.result === "ng").length;

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted no-print">
          <Link href={isOffice || isCompany ? backHref : homePathFor(profile.role)}>
            ← 一覧に戻る
          </Link>
        </p>

        <div className="card print-sheet">
          <div style={{ textAlign: "center", marginBottom: 18 }}>
            <h1 style={{ fontSize: 20, margin: 0 }}>衛生管理者職場巡視記録</h1>
            <div className="muted">{companyName}</div>
          </div>

          <table className="list" style={{ marginBottom: 14 }}>
            <tbody>
              <tr>
                <th style={{ width: 140 }}>巡視日</th>
                <td>{formatDateJa(p.patrol_date)}</td>
                <th style={{ width: 140 }}>種別</th>
                <td>{CHECKLIST_TYPES[p.checklist_type] ?? p.checklist_type}</td>
              </tr>
              <tr>
                <th>巡視者</th>
                <td>{p.inspector_name || "—"}</td>
                <th>要改善</th>
                <td>{ngCount > 0 ? `${ngCount}件` : "なし"}</td>
              </tr>
            </tbody>
          </table>

          <table className="list" style={{ marginBottom: 14 }}>
            <thead>
              <tr>
                <th>点検項目</th>
                <th style={{ width: 90 }}>判定</th>
                <th style={{ width: "30%" }}>メモ</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i}>
                  <td>{r.item}</td>
                  <td>
                    {r.result === "ng" ? (
                      <strong style={{ color: "var(--danger)" }}>
                        {RESULT_LABELS[r.result]}
                      </strong>
                    ) : (
                      RESULT_LABELS[r.result] ?? r.result
                    )}
                  </td>
                  <td>{r.note || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {p.summary && (
            <table className="list" style={{ marginBottom: 14 }}>
              <tbody>
                <tr>
                  <th style={{ width: 140 }}>特記事項・改善指示</th>
                  <td style={{ whiteSpace: "pre-wrap" }}>{p.summary}</td>
                </tr>
              </tbody>
            </table>
          )}

          <div className="no-print" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <PrintButton />
            {(isOffice || isCompany) && (
              <Link className="btn secondary" href={`/hygiene-patrols/${p.id}/edit`}>
                編集する
              </Link>
            )}
            {isOffice && <DeleteHygienePatrolButton patrolId={p.id} backHref={backHref} />}
          </div>
        </div>
      </main>
    </>
  );
}
