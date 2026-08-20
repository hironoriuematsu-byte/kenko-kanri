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
import { CHECKUP_TYPES, FOLLOWUP_STATUS, isFindingJudgment } from "@/lib/checkups";
import { WORK_JUDGMENTS } from "@/lib/interviews";

export const dynamic = "force-dynamic";

// 健診個人票(経年表示・印刷)
export default async function CheckupDetailPage({ params }: { params: { id: string } }) {
  const { profile } = await requireProfile();
  const supabase = createClient();

  const { data: c } = await supabase
    .from("hm_checkups")
    .select(
      "id, company_id, person_id, target_user_id, target_name, employee_no, birth_date, fiscal_year, checkup_type, checkup_date, overall_judgment, has_findings, work_judgment, work_judgment_note, work_judgment_date, followup_status, followup_note, companies(name)"
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

  // 経年: 同一人物を カルテ紐付け → アカウント → 氏名(+生年月日) の順で特定する
  let historyQuery = supabase
    .from("hm_checkups")
    .select(
      "id, fiscal_year, checkup_type, checkup_date, overall_judgment, has_findings, work_judgment"
    )
    .eq("company_id", c.company_id)
    .order("fiscal_year", { ascending: false });
  if (c.person_id) {
    historyQuery = historyQuery.eq("person_id", c.person_id);
  } else if (c.target_user_id) {
    historyQuery = historyQuery.eq("target_user_id", c.target_user_id);
  } else {
    historyQuery = historyQuery.eq("target_name", c.target_name);
    // 同姓同名対策: 生年月日があるものは生年月日でも絞り込む
    if (c.birth_date) historyQuery = historyQuery.eq("birth_date", c.birth_date);
  }
  const { data: allCheckups } = await historyQuery;

  const series = (allCheckups ?? []).slice(0, 6); // 直近6年分を横並び表示
  const history = series.filter((h) => h.id !== c.id);

  // 経年比較表(検査項目 × 年度)を組み立てる
  const { data: seriesItems } =
    series.length > 0
      ? await supabase
          .from("hm_checkup_items")
          .select("checkup_id, item_name, value, judgment, sort_order")
          .in(
            "checkup_id",
            series.map((s) => s.id)
          )
          .order("sort_order")
      : { data: [] };

  const cellMap = new Map<string, { value: string | null; judgment: string | null }>();
  const itemOrder = new Map<string, number>();
  for (const it of seriesItems ?? []) {
    cellMap.set(`${it.checkup_id}::${it.item_name}`, {
      value: it.value,
      judgment: it.judgment,
    });
    // 表示順は最新年度の並び順を優先し、古い年度にしかない項目は後ろへ
    const isCurrent = it.checkup_id === c.id;
    const prev = itemOrder.get(it.item_name);
    const order = (isCurrent ? 0 : 1000) + it.sort_order;
    if (prev == null || order < prev) itemOrder.set(it.item_name, order);
  }
  const comparisonItems = Array.from(itemOrder.entries())
    .sort((a, b) => a[1] - b[1])
    .map(([name]) => name);

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
                {(items ?? []).map((it) => {
                  const finding = isFindingJudgment(it.judgment);
                  return (
                    <tr key={it.id} style={finding ? { background: "var(--orange-light)" } : {}}>
                      <td>
                        {it.item_name}
                        {finding && (
                          <span className="badge orange" style={{ marginLeft: 6 }}>
                            有所見
                          </span>
                        )}
                      </td>
                      <td>{it.value ?? "—"}</td>
                      <td>
                        {finding ? (
                          <strong style={{ color: "var(--danger)" }}>{it.judgment}</strong>
                        ) : (
                          (it.judgment ?? "—")
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {history.length > 0 && (
            <>
              <h2 style={{ fontSize: 15, color: "var(--teal-dark)" }}>
                経年比較（直近{series.length}回）
              </h2>
              <div style={{ overflowX: "auto", marginBottom: 14 }}>
                <table className="list">
                  <thead>
                    <tr>
                      <th style={{ minWidth: 140 }}>検査項目</th>
                      {series.map((s) => (
                        <th key={s.id} style={{ minWidth: 110 }}>
                          {s.id === c.id ? (
                            <>
                              {s.fiscal_year}年度
                              <span className="badge" style={{ marginLeft: 4 }}>
                                今回
                              </span>
                            </>
                          ) : (
                            <Link href={`/checkup/${s.id}`}>{s.fiscal_year}年度</Link>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th>健診日</th>
                      {series.map((s) => (
                        <td key={s.id}>{formatDateJa(s.checkup_date)}</td>
                      ))}
                    </tr>
                    <tr>
                      <th>種別</th>
                      {series.map((s) => (
                        <td key={s.id}>{CHECKUP_TYPES[s.checkup_type] ?? s.checkup_type}</td>
                      ))}
                    </tr>
                    <tr>
                      <th>総合判定</th>
                      {series.map((s) => (
                        <td key={s.id}>
                          {s.overall_judgment && isFindingJudgment(s.overall_judgment) ? (
                            <strong style={{ color: "var(--danger)" }}>
                              {s.overall_judgment}
                            </strong>
                          ) : (
                            (s.overall_judgment ?? "—")
                          )}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <th>就業判定</th>
                      {series.map((s) => (
                        <td key={s.id}>
                          {s.work_judgment ? WORK_JUDGMENTS[s.work_judgment] : "—"}
                        </td>
                      ))}
                    </tr>
                    {comparisonItems.map((name) => (
                      <tr key={name}>
                        <th style={{ fontWeight: "normal" }}>{name}</th>
                        {series.map((s) => {
                          const cell = cellMap.get(`${s.id}::${name}`);
                          if (!cell) return <td key={s.id} className="muted">—</td>;
                          const finding = isFindingJudgment(cell.judgment);
                          return (
                            <td
                              key={s.id}
                              style={finding ? { background: "var(--orange-light)" } : {}}
                            >
                              {cell.value ?? "—"}
                              {cell.judgment && (
                                <span
                                  style={{
                                    marginLeft: 4,
                                    color: finding ? "var(--danger)" : "var(--muted)",
                                    fontWeight: finding ? 700 : 400,
                                  }}
                                >
                                  ({cell.judgment})
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="no-print" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <PrintButton />
            {isOffice && c.target_user_id && (
              <Link
                className="btn secondary"
                href={`/office/${c.company_id}/person/${c.target_user_id}`}
              >
                個人統合ビュー
              </Link>
            )}
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
