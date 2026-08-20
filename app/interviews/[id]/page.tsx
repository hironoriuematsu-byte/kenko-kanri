import Link from "next/link";
import { notFound } from "next/navigation";
import Header from "@/components/Header";
import InterviewRecordPanel from "@/components/InterviewRecordPanel";
import OpinionPanel from "@/components/OpinionPanel";
import PreInfoPanel from "@/components/PreInfoPanel";
import CancelInterviewButton from "@/components/CancelInterviewButton";
import { requireProfile, homePathFor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  INTERVIEW_TYPES,
  INTERVIEW_METHODS,
  INTERVIEW_STATUS,
  WORK_JUDGMENTS,
  formatDateTimeJa,
} from "@/lib/interviews";
import { formatDateJa } from "@/lib/fiscal";

export const dynamic = "force-dynamic";

export default async function InterviewDetailPage({ params }: { params: { id: string } }) {
  const { profile } = await requireProfile();
  const supabase = createClient();

  const { data: iv } = await supabase
    .from("hm_interviews")
    .select(
      "id, company_id, person_id, target_user_id, target_name, interview_type, scheduled_at, method, location, status, companies(name)"
    )
    .eq("id", params.id)
    .single();
  if (!iv) notFound();

  await supabase.rpc("hm_log_access", {
    p_action: "view",
    p_target_table: "hm_interviews",
    p_target_id: iv.id,
  });

  const { data: opinion } = await supabase
    .from("hm_interview_opinions")
    .select("id, interview_date, work_judgment, opinion, issued_date, physician_name, published")
    .eq("interview_id", iv.id)
    .maybeSingle();

  const isOffice = profile.role === "office";
  const isCompany = profile.role === "company" && profile.company_id === iv.company_id;
  const companyName = (iv as any).companies?.name ?? "";
  // 面談予定日(ローカル日付)を実施日の既定値に使う
  const scheduledDate = iv.scheduled_at
    ? (() => {
        const d = new Date(iv.scheduled_at);
        const pad = (n: number) => n.toString().padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      })()
    : "";

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted no-print">
          <Link href={isOffice ? `/office/${iv.company_id}` : homePathFor(profile.role)}>
            ← 一覧に戻る
          </Link>
        </p>
        <h1 className="page-title">
          面談: {iv.target_name}（{INTERVIEW_TYPES[iv.interview_type] ?? iv.interview_type}）
        </h1>

        <div className="card">
          <h2>予定</h2>
          <table className="list">
            <tbody>
              <tr>
                <th style={{ width: 140 }}>企業</th>
                <td>{companyName}</td>
              </tr>
              <tr>
                <th>予定日時</th>
                <td>{formatDateTimeJa(iv.scheduled_at)}</td>
              </tr>
              <tr>
                <th>実施方法</th>
                <td>{iv.method ? INTERVIEW_METHODS[iv.method] : "未定"}</td>
              </tr>
              <tr>
                <th>場所 / 接続先</th>
                <td>{iv.location || "—"}</td>
              </tr>
              <tr>
                <th>状態</th>
                <td>{INTERVIEW_STATUS[iv.status] ?? iv.status}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            {(isOffice || isCompany) && iv.status === "scheduled" && (
              <Link className="btn secondary" href={`/interviews/${iv.id}/edit`}>
                {isOffice ? "予定を編集" : "日程を調整"}
              </Link>
            )}
            {(isOffice || isCompany) && iv.person_id && (
              <Link className="btn secondary" href={`/karte/${iv.person_id}`}>
                カルテを開く
              </Link>
            )}
            {isOffice && iv.target_user_id && (
              <Link
                className="btn secondary"
                href={`/office/${iv.company_id}/person/${iv.target_user_id}`}
              >
                個人統合ビュー
              </Link>
            )}
            {isOffice && iv.status === "scheduled" && (
              <CancelInterviewButton interviewId={iv.id} />
            )}
          </div>
        </div>

        {(isOffice || isCompany) && (
          <div className="card">
            <h2>事前情報</h2>
            <p className="muted">
              企業担当者と産業医事務所の間で共有されます。対象の従業員本人には表示されません。
            </p>
            <PreInfoPanel interviewId={iv.id} />
          </div>
        )}

        {isOffice && (
          <>
            <div className="card">
              <h2>実施記録（office限定）</h2>
              <InterviewRecordPanel interviewId={iv.id} defaultDate={scheduledDate} />
            </div>
            <div className="card">
              <h2>事業者向け 意見書</h2>
              <OpinionPanel
                interviewId={iv.id}
                companyId={iv.company_id}
                initial={{
                  id: opinion?.id,
                  interview_date: opinion?.interview_date ?? scheduledDate,
                  work_judgment: opinion?.work_judgment ?? "",
                  opinion: opinion?.opinion ?? "",
                  issued_date: opinion?.issued_date ?? "",
                  physician_name: opinion?.physician_name ?? profile.full_name ?? "上松弘典",
                  published: opinion?.published ?? false,
                }}
              />
            </div>
          </>
        )}

        {isCompany && (
          <div className="card">
            <h2>産業医の意見書</h2>
            {opinion ? (
              <>
                <table className="list">
                  <tbody>
                    <tr>
                      <th style={{ width: 140 }}>面談実施日</th>
                      <td>{formatDateJa(opinion.interview_date)}</td>
                    </tr>
                    <tr>
                      <th>就業区分</th>
                      <td>
                        {opinion.work_judgment
                          ? WORK_JUDGMENTS[opinion.work_judgment]
                          : "—"}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p style={{ marginTop: 12 }}>
                  <Link className="btn" href={`/interview-sheet/${iv.id}`}>
                    意見書を表示（印刷/PDF）
                  </Link>
                </p>
              </>
            ) : (
              <p className="muted">
                意見書はまだ公開されていません。産業医事務所が作成・公開すると、ここに表示されます。
              </p>
            )}
          </div>
        )}
      </main>
    </>
  );
}
