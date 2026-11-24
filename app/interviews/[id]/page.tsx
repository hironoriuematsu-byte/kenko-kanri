import Link from "next/link";
import { notFound } from "next/navigation";
import Header from "@/components/Header";
import InterviewRecordPanel from "@/components/InterviewRecordPanel";
import OpinionPanel from "@/components/OpinionPanel";
import PreInfoPanel from "@/components/PreInfoPanel";
import CancelInterviewButton from "@/components/CancelInterviewButton";
import StressResultsCard, { type RequestedStressResult } from "@/components/StressResultsCard";
import { requireProfile, homePathFor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  INTERVIEW_TYPES,
  INTERVIEW_METHODS,
  WORK_JUDGMENTS,
  interviewStatusLabel,
  isOpinionOnly,
  formatDateTimeJa,
  findPreviousInterview,
} from "@/lib/interviews";
import { formatDateJa } from "@/lib/fiscal";

export const dynamic = "force-dynamic";

export default async function InterviewDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  // ログイン確認・面談・意見書・閲覧ログは互いに依存しないので同時に行う(表示までの待ち時間を短くする)
  const [{ profile }, { data: iv }, { data: opinion }] = await Promise.all([
    requireProfile(),
    supabase
      .from("hm_interviews")
      .select(
        "id, company_id, person_id, target_user_id, target_name, interview_type, scheduled_at, method, location, status, interview_request_id, companies(name)"
      )
      .eq("id", params.id)
      .single(),
    supabase
      .from("hm_interview_opinions")
      .select("id, interview_date, work_judgment, opinion, issued_date, physician_name, published")
      .eq("interview_id", params.id)
      .maybeSingle(),
    supabase.rpc("hm_log_access", {
      p_action: "view",
      p_target_table: "hm_interviews",
      p_target_id: params.id,
    }),
  ]);
  if (!iv) notFound();

  // 手で登録した「高ストレス面接指導」で、本人の申出を確かめていないものは、会社の担当者に表示しない(SQL 0159)。
  // 実施者には、その状態を知らせる(列がまだ無ければ何も出さない)
  let hiddenFromCompany = false;
  if (iv.interview_type === "high_stress" && !iv.interview_request_id) {
    const { data: c, error: cErr } = await supabase.from("hm_interviews").select("request_confirmed").eq("id", params.id).maybeSingle();
    hiddenFromCompany = !cErr && c != null && !c.request_confirmed;
  }

  // ストレスチェックWebの面接指導の申出から登録された面談: 申出のもとになったストレスチェック結果(0148。未適用なら出さない)
  let stressRows: RequestedStressResult[] = [];
  if (iv.interview_request_id && iv.target_user_id) {
    const { data, error } = await supabase.rpc("hm_requested_stress_results", { p_user_id: iv.target_user_id });
    if (!error) stressRows = ((data as RequestedStressResult[]) ?? []).filter((r) => r.interview_request_id === iv.interview_request_id);
  }

  const isOffice = profile.role === "office";
  const isCompany = profile.role === "company" && profile.company_id === iv.company_id;
  const companyName = (iv as any).companies?.name ?? "";
  // 面談後の追加意見(前回の面談の意見の続きとして出す。文言を切り替える)
  const opinionOnly = isOpinionOnly(iv.interview_type);
  const previous = opinionOnly ? await findPreviousInterview(supabase, iv) : null;
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
          {opinionOnly ? "産業医意見" : "面談"}: {iv.target_name}（{INTERVIEW_TYPES[iv.interview_type] ?? iv.interview_type}）
        </h1>

        <div className="card">
          <h2>{opinionOnly ? "概要" : "予定"}</h2>
          <table className="list">
            <tbody>
              <tr>
                <th style={{ width: 140 }}>企業</th>
                <td>{companyName}</td>
              </tr>
              <tr>
                <th>{opinionOnly ? "意見日" : "面談日"}</th>
                <td>{formatDateTimeJa(iv.scheduled_at)}</td>
              </tr>
              {opinionOnly && previous && (
                <tr>
                  <th>前回の面談</th>
                  <td>
                    <Link href={`/interviews/${previous.id}`}>
                      {INTERVIEW_TYPES[previous.interview_type] ?? previous.interview_type}
                      {previous.date ? `（${formatDateJa(previous.date)}）` : ""}
                    </Link>
                  </td>
                </tr>
              )}
              {!opinionOnly && (
                <>
                  <tr>
                    <th>実施方法</th>
                    <td>{iv.method ? INTERVIEW_METHODS[iv.method] : "未定"}</td>
                  </tr>
                  <tr>
                    <th>場所 / 接続先</th>
                    <td>{iv.location || "—"}</td>
                  </tr>
                </>
              )}
              <tr>
                <th>状態</th>
                <td>{interviewStatusLabel(iv.status, iv.interview_type)}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            {(isOffice || isCompany) && iv.status === "scheduled" && (
              <Link className="btn secondary" href={`/interviews/${iv.id}/edit`}>
                {opinionOnly ? "内容を編集" : isOffice ? "予定を編集" : "日程を調整"}
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
              <CancelInterviewButton interviewId={iv.id} opinionOnly={opinionOnly} />
            )}
          </div>
        </div>

        {isOffice && hiddenFromCompany && (
          <div className="card" style={{ borderColor: "var(--orange)", background: "var(--orange-light)" }}>
            <strong>この面談は、会社の担当者には表示されていません。</strong>
            <p style={{ margin: "6px 0 0", fontSize: 14 }}>
              「高ストレス面接指導」は、本人から面接指導の申出があった(会社への結果の提供に同意している)方の予定だけを会社に見せます。
              申出があった方は「予定を編集」で「本人から面接指導の申出があった」にチェックを入れてください。
              申出のない方の相談であれば、種別を「その他・健康相談等」に変えてください。
            </p>
          </div>
        )}

        {(isOffice || isCompany) && <StressResultsCard rows={stressRows} showReportLink={isOffice} />}

        {(isOffice || isCompany) && (
          <div className="card">
            <h2>{opinionOnly ? "事業場からの報告" : "事前情報"}</h2>
            <p className="muted">
              企業担当者と産業医事務所の間で共有されます。対象の従業員本人には表示されません。
            </p>
            <PreInfoPanel interviewId={iv.id} />
          </div>
        )}

        {isOffice && (
          <>
            <div className="card">
              <h2>{opinionOnly ? "経過の記録" : "実施記録"}（産業医事務所のみ・企業には共有されません）</h2>
              <InterviewRecordPanel interviewId={iv.id} defaultDate={scheduledDate} interviewRequestId={iv.interview_request_id} opinionOnly={opinionOnly} />
            </div>
            <div className="card">
              <h2>事業者向け 意見書</h2>
              <OpinionPanel
                interviewId={iv.id}
                companyId={iv.company_id}
                opinionOnly={opinionOnly}
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
                      <th style={{ width: 140 }}>{opinionOnly ? "意見日" : "面談実施日"}</th>
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
