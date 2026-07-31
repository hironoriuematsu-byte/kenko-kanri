import Link from "next/link";
import { notFound } from "next/navigation";
import Header from "@/components/Header";
import PrintButton from "@/components/PrintButton";
import DeletePatrolButton from "@/components/DeletePatrolButton";
import { requireProfile, homePathFor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateJa } from "@/lib/fiscal";
import { combinePatrolText } from "@/lib/patrols";

export const dynamic = "force-dynamic";

// 産業医巡視記録の詳細(印刷様式)
export default async function PatrolDetailPage({ params }: { params: { id: string } }) {
  const { profile } = await requireProfile();
  const supabase = createClient();

  const { data: p } = await supabase
    .from("hm_patrols")
    .select(
      "id, company_id, patrol_date, areas, findings, advice, note, physician_name, companies(name)"
    )
    .eq("id", params.id)
    .single();
  if (!p) notFound();

  await supabase.rpc("hm_log_access", {
    p_action: "view",
    p_target_table: "hm_patrols",
    p_target_id: p.id,
  });

  const isOffice = profile.role === "office";
  const companyName = (p as any).companies?.name ?? "";
  const backHref = isOffice ? `/office/${p.company_id}/patrols` : "/company/patrols";

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted no-print">
          <Link href={profile.role === "employee" ? homePathFor(profile.role) : backHref}>
            ← 一覧に戻る
          </Link>
        </p>

        <div className="card print-sheet">
          <div style={{ textAlign: "center", marginBottom: 18 }}>
            <h1 style={{ fontSize: 20, margin: 0 }}>産業医職場巡視記録</h1>
            <div className="muted">{companyName}</div>
          </div>

          <table className="list" style={{ marginBottom: 16 }}>
            <tbody>
              <tr>
                <th style={{ width: 160 }}>巡視日</th>
                <td>{formatDateJa(p.patrol_date)}</td>
              </tr>
              <tr>
                <th>指摘事項等</th>
                <td style={{ whiteSpace: "pre-wrap" }}>{combinePatrolText(p) || "—"}</td>
              </tr>
              <tr>
                <th>産業医</th>
                <td>{p.physician_name || "—"}</td>
              </tr>
            </tbody>
          </table>

          <div className="no-print" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <PrintButton />
            {isOffice && (
              <>
                <Link className="btn secondary" href={`/patrols/${p.id}/edit`}>
                  編集する
                </Link>
                <DeletePatrolButton patrolId={p.id} backHref={backHref} />
              </>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
