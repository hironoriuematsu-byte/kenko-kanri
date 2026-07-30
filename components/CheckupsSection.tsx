import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDateJa } from "@/lib/fiscal";
import { CHECKUP_TYPES, FOLLOWUP_STATUS } from "@/lib/checkups";
import { WORK_JUDGMENTS } from "@/lib/interviews";

// 健診一覧+集計(サーバーコンポーネント)。office/company共用
export default async function CheckupsSection({
  companyId,
  basePath,
  selectedYear,
  canEdit,
}: {
  companyId: string;
  basePath: string;
  selectedYear?: number;
  canEdit: boolean;
}) {
  const supabase = createClient();

  const { data: yearRows } = await supabase
    .from("hm_checkups")
    .select("fiscal_year")
    .eq("company_id", companyId)
    .order("fiscal_year", { ascending: false });
  const years = Array.from(new Set((yearRows ?? []).map((r) => r.fiscal_year)));
  const year = selectedYear ?? years[0];

  const { data: checkups } = year
    ? await supabase
        .from("hm_checkups")
        .select(
          "id, target_name, employee_no, checkup_type, checkup_date, overall_judgment, has_findings, work_judgment, followup_status"
        )
        .eq("company_id", companyId)
        .eq("fiscal_year", year)
        .order("employee_no", { ascending: true, nullsFirst: false })
        .order("target_name")
    : { data: [] };

  const list = checkups ?? [];
  const total = list.length;
  const findings = list.filter((c) => c.has_findings).length;
  const pending = list.filter((c) => c.followup_status === "pending").length;
  // 個人特定防止: 10名未満のグループは率を表示しない
  const rate = total >= 10 ? Math.round((findings / total) * 1000) / 10 : null;

  return (
    <div>
      {canEdit && (
        <p style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link className="btn orange" href={`${basePath}/import`}>
            CSV一括取込
          </Link>
          <Link className="btn secondary" href={`${basePath}/new`}>
            ＋ 個別入力
          </Link>
        </p>
      )}

      {years.length > 0 && (
        <p style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span className="muted">年度:</span>
          {years.map((y) => (
            <Link
              key={y}
              href={`${basePath}?year=${y}`}
              className={y === year ? "badge" : ""}
              style={y === year ? {} : { padding: "2px 8px" }}
            >
              {y}年度
            </Link>
          ))}
        </p>
      )}

      {year ? (
        <>
          <table className="list" style={{ marginBottom: 14, maxWidth: 560 }}>
            <tbody>
              <tr>
                <th>受診者数</th>
                <td>{total}名</td>
                <th>有所見者</th>
                <td>{findings}名</td>
              </tr>
              <tr>
                <th>有所見率</th>
                <td>
                  {rate !== null ? (
                    `${rate}%`
                  ) : (
                    <span className="muted">10名未満のため非表示</span>
                  )}
                </td>
                <th>事後措置 未対応</th>
                <td>
                  {pending > 0 ? <span className="badge orange">{pending}名</span> : "0名"}
                </td>
              </tr>
            </tbody>
          </table>

          <table className="list">
            <thead>
              <tr>
                <th>社員番号</th>
                <th>氏名</th>
                <th>種別</th>
                <th>健診日</th>
                <th>総合判定</th>
                <th>有所見</th>
                <th>就業判定</th>
                <th>事後措置</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id}>
                  <td>{c.employee_no || "—"}</td>
                  <td>
                    <Link href={`/checkup/${c.id}`}>{c.target_name}</Link>
                  </td>
                  <td>{CHECKUP_TYPES[c.checkup_type] ?? c.checkup_type}</td>
                  <td>{formatDateJa(c.checkup_date)}</td>
                  <td>{c.overall_judgment || "—"}</td>
                  <td>{c.has_findings ? <span className="badge orange">有</span> : "—"}</td>
                  <td>{c.work_judgment ? WORK_JUDGMENTS[c.work_judgment] : "未判定"}</td>
                  <td>
                    {c.followup_status === "pending" ? (
                      <span className="badge orange">{FOLLOWUP_STATUS[c.followup_status]}</span>
                    ) : (
                      FOLLOWUP_STATUS[c.followup_status] ?? "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="muted">健診結果はまだ登録されていません。</p>
      )}
    </div>
  );
}
