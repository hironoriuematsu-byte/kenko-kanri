import Link from "next/link";
import { notFound } from "next/navigation";
import Header from "@/components/Header";
import PrintButton from "@/components/PrintButton";
import WorkJudgmentPanel from "@/components/WorkJudgmentPanel";
import FollowupPanel from "@/components/FollowupPanel";
import DeleteCheckupButton from "@/components/DeleteCheckupButton";
import { requireProfile, homePathFor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateJa } from "@/lib/fiscal";
import { CHECKUP_TYPES, FOLLOWUP_STATUS } from "@/lib/checkups";
import { WORK_JUDGMENTS } from "@/lib/interviews";

export const dynamic = "force-dynamic";

// 健診個人票(経年表示・印刷)
export default async function CheckupDetailPage({ params }: { params: { id: string } }) {
  const { profile } = await requireProfile();
  const supabase = createClient();

  const { data: c } = await supabase
    .from("hm_checkups")
    .select(
      "id, company_id, target_user_id, target_name, employee_no, fiscal_year, checkup_type, checkup_date, overall_judgment, has_findings, work_judgment, work_judgment_note, work_judgment_date, followup_status, followup_note, companies(name)"
    )
    .eq("id", params.id)
    .single();
  if (!c) notFound();

  await supabase.rpc("hm_log_access", {
    p_action: "view",
    p_target_table: "hm_checkups",
    p_target_id: c.id,
  });

  const { data: items } = await supabase
    .from("hm_checkup_items")
    .select("id, item_name, value, judgment")
    .eq("checkup_id", c.id)
    .order("sort_order");

  // 経年: 同一人物(アカウント紐付け or 同姓同名+同企業)の他年度
  let historyQuery = supabase
    .from("hm_checkups")
    .select("id, fiscal_year, checkup_type, checkup_date, overall_judgment, has_findings, work_judgment")
    .eq("company_id", c.company_id)
    .neq("id", c.id)
    .order("fiscal_year", { ascending: false });
  historyQuery = c.target_user_id
    ? historyQuery.eq("target_user_id", c.target_user_id)
    : historyQuery.eq("target_name", c.target_name);
  const { data: history } = await historyQuery;

  const isOffice = profile.role === "office";
  const isCompany = profile.role === "company" && profile.company_id === c.company_id;
  const backHref = isOffice
    ? `/office/${c.company_id}/checkups`
    : isCompany
      ? "/company/checkups"
      : homePathFor(profile.role);
  const companyName = (c as any).companies?.name ?? "";

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted no-print">
          <Link href={backHref}>← 一覧に戻る</Link>
        </p>

        <div className="card print-sheet">
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <h1 style={{ fontSize: 20, margin: 0 }}>健康診断個人票</h1>
            <div className="muted">{companyName}</div>
          </div>

          <table className="list" style={{ marginBottom: 14 }}>
            <tbody>
              <tr>
                <th style={{ width: 140 }}>氏名</th>
                <td>{c.target_name}</td>
                <th style={{ width: 140 }}>社員番号</th>
                <td>{c.employee_no || "—"}</td>
              </tr>
              <tr>
                <th>年度 / 種別</th>
                <td>
                  {c.fiscal_year}年度 / {CHECKUP_TYPES[c.checkup_type] ?? c.checkup_type}
                </td>
                <th>健診日</th>
                <td>{formatDateJa(c.checkup_date)}</td>
              </tr>
              <tr>
                <th>総合判定</th>
                <td>
                  {c.overall_judgment || "—"}
                  {c.has_findings && (
                    <span className="badge orange" style={{ marginLeft: 8 }}>
                      有所見
                    </span>
                  )}
                </td>
                <th>就業判定</th>
                <td>
                  {c.work_judgment ? (
                    <>
                      <strong>{WORK_JUDGMENTS[c.work_judgment]}</strong>
                      <span className="muted">
                        （{formatDateJa(c.work_judgment_date)}）
                      </span>
                    </>
                  ) : (
                    "未判定"
                  )}
                </td>
              </tr>
              {c.work_judgment_note && (
                <tr>
                  <th>医師の意見</th>
                  <td colSpan={3} style={{ whiteSpace: "pre-wrap" }}>
                    {c.work_judgment_note}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {(items ?? []).length > 0 && (
            <table className="list" style={{ marginBottom: 14 }}>
              <thead>
                <tr>
                  <th>検査項目</th>
                  <th>測定値</th>
                  <th style={{ width: 90 }}>判定</th>
                </tr>
              </thead>
              <tbody>
                {(items ?? []).map((it) => (
                  <tr key={it.id}>
                    <td>{it.item_name}</td>
                    <td>{it.value ?? "—"}</td>
                    <td>{it.judgment ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {(history ?? []).length > 0 && (
            <>
              <h2 style={{ fontSize: 15, color: "var(--teal-dark)" }}>経年推移</h2>
              <table className="list" style={{ marginBottom: 14 }}>
                <thead>
                  <tr>
                    <th>年度</th>
                    <th>種別</th>
                    <th>健診日</th>
                    <th>総合判定</th>
                    <th>有所見</th>
                    <th>就業判定</th>
                  </tr>
                </thead>
                <tbody>
                  {(history ?? []).map((h) => (
                    <tr key={h.id}>
                      <td>
                        <Link href={`/checkup/${h.id}`}>{h.fiscal_year}年度</Link>
                      </td>
                      <td>{CHECKUP_TYPES[h.checkup_type] ?? h.checkup_type}</td>
                      <td>{formatDateJa(h.checkup_date)}</td>
                      <td>{h.overall_judgment || "—"}</td>
                      <td>{h.has_findings ? "有" : "—"}</td>
                      <td>{h.work_judgment ? WORK_JUDGMENTS[h.work_judgment] : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div className="no-print" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <PrintButton />
            {isOffice && <DeleteCheckupButton checkupId={c.id} backHref={backHref} />}
          </div>
        </div>

        {isOffice && (
          <div className="card no-print">
            <h2>就業判定（office限定）</h2>
            <WorkJudgmentPanel
              checkupId={c.id}
              initial={{
                judgment: c.work_judgment ?? "",
                note: c.work_judgment_note ?? "",
                date: c.work_judgment_date ?? "",
              }}
            />
          </div>
        )}

        {(isOffice || isCompany) && (
          <div className="card no-print">
            <h2>事後措置フォロー</h2>
            <p className="muted">
              現在の状況:{" "}
              {c.followup_status === "pending" ? (
                <span className="badge orange">{FOLLOWUP_STATUS[c.followup_status]}</span>
              ) : (
                FOLLOWUP_STATUS[c.followup_status]
              )}
            </p>
            <FollowupPanel
              checkupId={c.id}
              initial={{ status: c.followup_status, note: c.followup_note ?? "" }}
            />
          </div>
        )}
      </main>
    </>
  );
}
