import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import CheckupsTable, { type CheckupRow } from "@/components/CheckupsTable";
import { isFindingJudgment, needsAttention } from "@/lib/checkups";

// 健診一覧+集計(サーバーコンポーネント)。office/company共用
export default async function CheckupsSection({
  companyId,
  basePath,
  selectedYear,
  canEdit,
  canDelete = false,
  canJudge = false,
}: {
  companyId: string;
  basePath: string;
  selectedYear?: number;
  canEdit: boolean;
  canDelete?: boolean;
  canJudge?: boolean;
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
          "id, target_name, employee_no, checkup_type, checkup_date, overall_judgment, has_findings, work_judgment, work_judgment_note, work_judgment_date"
        )
        .eq("company_id", companyId)
        .eq("fiscal_year", year)
        .order("employee_no", { ascending: true, nullsFirst: false })
        .order("target_name")
    : { data: [] };

  // 有所見の検査項目を一覧に表示するため、該当年度分の項目をまとめて取得
  const ids = (checkups ?? []).map((c) => c.id);
  const { data: items } =
    ids.length > 0
      ? await supabase
          .from("hm_checkup_items")
          .select("checkup_id, item_name, judgment, sort_order")
          .in("checkup_id", ids)
          .order("sort_order")
      : { data: [] };

  const findingsByCheckup = new Map<string, { item_name: string; judgment: string | null }[]>();
  for (const it of items ?? []) {
    if (!isFindingJudgment(it.judgment)) continue;
    const arr = findingsByCheckup.get(it.checkup_id) ?? [];
    arr.push({ item_name: it.item_name, judgment: it.judgment });
    findingsByCheckup.set(it.checkup_id, arr);
  }

  const list = (checkups ?? []).map((c) => ({
    ...c,
    findingItems: findingsByCheckup.get(c.id) ?? [],
  }));
  const total = list.length;
  // 有所見は総合判定 B・C・D で判定する
  const findings = list.filter((c) =>
    ["B", "C", "D"].includes((c.overall_judgment ?? "").trim().charAt(0).toUpperCase())
  ).length;
  // 医師の指示人数は総合判定 D で集計する
  const instructed = list.filter(
    (c) => (c.overall_judgment ?? "").trim().charAt(0).toUpperCase() === "D"
  ).length;
  const instructedRate =
    total >= 10 ? Math.round((instructed / total) * 1000) / 10 : null;
  const attention = list.filter((c) => needsAttention(c.work_judgment)).length;
  const held = list.filter((c) => c.work_judgment === "pending").length;
  const restricted = list.filter(
    (c) => c.work_judgment === "restricted" || c.work_judgment === "leave"
  ).length;
  // 個人特定防止: 10名未満のグループは率を表示しない
  const rate = total >= 10 ? Math.round((findings / total) * 1000) / 10 : null;

  return (
    <div>
      <p style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {canEdit && (
          <>
            <Link className="btn orange" href={`${basePath}/import`}>
              CSV一括取込
            </Link>
            <Link className="btn secondary" href={`${basePath}/new`}>
              ＋ 個別入力
            </Link>
          </>
        )}
        {year && (
          <Link className="btn" href={`${basePath}/report?year=${year}`}>
            定期健診結果報告書のサマリ・CSV出力
          </Link>
        )}
      </p>

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
                <th>有所見者数</th>
                <td>
                  {findings}名
                  <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>
                    （総合判定B・C・D）
                  </span>
                </td>
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
                <th>医師の指示人数</th>
                <td>
                  {instructed}名
                  <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>
                    （総合判定D）
                  </span>
                </td>
              </tr>
              <tr>
                <th>医師の指示人数率</th>
                <td>
                  {instructedRate !== null ? (
                    `${instructedRate}%`
                  ) : (
                    <span className="muted">10名未満のため非表示</span>
                  )}
                </td>
                <th>就業判定 要対応</th>
                <td>
                  {attention > 0 ? (
                    <span className="badge orange">{attention}名</span>
                  ) : (
                    "0名"
                  )}
                  {held > 0 && (
                    <span className="muted" style={{ marginLeft: 6 }}>
                      （うち判定保留 {held}名）
                    </span>
                  )}
                </td>
              </tr>
              <tr>
                <th>就業制限・要休業</th>
                <td colSpan={3}>
                  {restricted > 0 ? (
                    <>
                      <strong style={{ color: "var(--danger)" }}>{restricted}名</strong>
                      <span className="muted" style={{ marginLeft: 8 }}>
                        該当者の「医師の意見」欄をご確認のうえ、就業上の措置をご検討ください
                      </span>
                    </>
                  ) : (
                    "0名"
                  )}
                </td>
              </tr>
            </tbody>
          </table>

          <CheckupsTable
            rows={list as CheckupRow[]}
            canDelete={canDelete}
            canJudge={canJudge}
          />
        </>
      ) : (
        <p className="muted">健診結果はまだ登録されていません。</p>
      )}
    </div>
  );
}
