import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import PrintButton from "@/components/PrintButton";
import { requireProfile, homePathFor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { INTERVIEW_TYPES, WORK_JUDGMENTS } from "@/lib/interviews";
import { formatDateJa } from "@/lib/fiscal";

export const dynamic = "force-dynamic";

// 事業者向け 面談結果報告・意見書(印刷様式)
export default async function InterviewSheetPage({ params }: { params: { id: string } }) {
  const { profile } = await requireProfile();
  if (profile.role !== "office" && profile.role !== "company") {
    redirect(homePathFor(profile.role));
  }

  const supabase = createClient();
  const { data: iv } = await supabase
    .from("hm_interviews")
    .select("id, company_id, target_name, interview_type, companies(name)")
    .eq("id", params.id)
    .single();
  if (!iv) notFound();

  const { data: opinion } = await supabase
    .from("hm_interview_opinions")
    .select(
      "id, interview_date, work_judgment, opinion, physician_name, issued_date, published"
    )
    .eq("interview_id", iv.id)
    .maybeSingle();
  // companyロールにはRLSで公開済みのみ返る。未公開はここで404相当に
  if (!opinion) notFound();

  await supabase.rpc("hm_log_access", {
    p_action: "view_sheet",
    p_target_table: "hm_interview_opinions",
    p_target_id: opinion.id,
  });

  const companyName = (iv as any).companies?.name ?? "";

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted no-print">
          <Link href={`/interviews/${iv.id}`}>← 面談詳細に戻る</Link>
        </p>

        <div className="card print-sheet">
          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <h1 style={{ fontSize: 20, margin: 0 }}>面談結果報告・意見書</h1>
          </div>

          <p>{companyName} 御中</p>

          <table className="list" style={{ marginBottom: 16 }}>
            <tbody>
              <tr>
                <th style={{ width: 160 }}>対象者氏名</th>
                <td>{iv.target_name}</td>
              </tr>
              <tr>
                <th>面談種別</th>
                <td>{INTERVIEW_TYPES[iv.interview_type] ?? iv.interview_type}</td>
              </tr>
              <tr>
                <th>面談実施日</th>
                <td>{formatDateJa(opinion.interview_date)}</td>
              </tr>
              <tr>
                <th>就業区分の判定</th>
                <td>
                  {opinion.work_judgment ? (
                    <strong>{WORK_JUDGMENTS[opinion.work_judgment]}</strong>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
              <tr>
                <th>就業上の措置に関する意見</th>
                <td style={{ whiteSpace: "pre-wrap" }}>{opinion.opinion || "—"}</td>
              </tr>
            </tbody>
          </table>

          <div style={{ textAlign: "right", marginTop: 24 }}>
            <div>発行日: {formatDateJa(opinion.issued_date)}</div>
            <div style={{ marginTop: 8 }}>
              うえまつ産業医事務所　産業医　{opinion.physician_name || ""}
            </div>
          </div>

          {!opinion.published && profile.role === "office" && (
            <p className="notice no-print" style={{ marginTop: 16 }}>
              この意見書はまだ企業側に公開されていません。
            </p>
          )}

          <div className="no-print" style={{ marginTop: 18 }}>
            <PrintButton />
          </div>
        </div>
      </main>
    </>
  );
}
