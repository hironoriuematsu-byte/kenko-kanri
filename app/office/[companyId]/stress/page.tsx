import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getFiscalYear } from "@/lib/fiscal";

export const dynamic = "force-dynamic";

// ストレスチェック連携: 高ストレス者一覧と集団サマリー(既存データは読み取り専用)
export default async function StressPage({
  params,
  searchParams,
}: {
  params: { companyId: string };
  searchParams: { year?: string };
}) {
  const { profile } = await requireProfile();
  if (profile.role !== "office") redirect("/");

  const supabase = createClient();
  const { data: company } = await supabase
    .from("companies")
    .select("id, name")
    .eq("id", params.companyId)
    .single();
  if (!company) notFound();

  const year = searchParams.year ? Number(searchParams.year) : getFiscalYear();

  const [listRes, summaryRes, checkupRows] = await Promise.all([
    supabase.rpc("hm_high_stress_list", {
      p_company_id: company.id,
      p_fiscal_year: year,
    }),
    supabase.rpc("hm_stress_summary", {
      p_company_id: company.id,
      p_fiscal_year: year,
    }),
    supabase
      .from("hm_checkups")
      .select("id, has_findings")
      .eq("company_id", company.id)
      .eq("fiscal_year", year),
  ]);

  const notConnected =
    (listRes.error && /function|schema cache/i.test(listRes.error.message)) ||
    (summaryRes.error && /function|schema cache/i.test(summaryRes.error.message));

  const highStress = (listRes.data as any[]) ?? [];
  const summary = Array.isArray(summaryRes.data)
    ? (summaryRes.data as any[])[0]
    : summaryRes.data;

  const checkups = checkupRows.data ?? [];
  const checkupTotal = checkups.length;
  const findings = checkups.filter((c) => c.has_findings).length;
  const findingsRate =
    checkupTotal >= 10 ? Math.round((findings / checkupTotal) * 1000) / 10 : null;

  const years = [year - 2, year - 1, year, year + 1].filter((y) => y <= getFiscalYear());

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href={`/office/${company.id}`}>← {company.name}</Link>
        </p>
        <h1 className="page-title">{company.name} — ストレスチェック連携</h1>

        {notConnected ? (
          <div className="notice">
            ストレスチェック連携が未設定です。開発環境では{" "}
            <code>supabase/dev_setup/0002_dev_stress_mock.sql</code>{" "}
            を、本番では実テーブルの列名を確認のうえ{" "}
            <code>supabase/migrations/0105_hm_stress_link_template.sql</code>{" "}
            を調整してSQL Editorで実行してください。
          </div>
        ) : (
          <>
            <p style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="muted">年度:</span>
              {years.map((y) => (
                <Link
                  key={y}
                  href={`/office/${company.id}/stress?year=${y}`}
                  className={y === year ? "badge" : ""}
                  style={y === year ? {} : { padding: "2px 8px" }}
                >
                  {y}年度
                </Link>
              ))}
            </p>

            <div className="card">
              <h2>集団サマリー（{year}年度）</h2>
              <table className="list" style={{ maxWidth: 620 }}>
                <tbody>
                  <tr>
                    <th>ストレスチェック受検者数</th>
                    <td>{summary?.total ?? 0}名</td>
                    <th>高ストレス率</th>
                    <td>
                      {summary?.high_stress_rate != null ? (
                        `${summary.high_stress_rate}%（${summary.high_stress}名）`
                      ) : (
                        <span className="muted">10名未満のため非表示</span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <th>健診受診者数</th>
                    <td>{checkupTotal}名</td>
                    <th>有所見率</th>
                    <td>
                      {findingsRate != null ? (
                        `${findingsRate}%（${findings}名）`
                      ) : (
                        <span className="muted">10名未満のため非表示</span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="card">
              <h2>高ストレス者一覧（{year}年度）</h2>
              {highStress.length > 0 ? (
                <table className="list">
                  <thead>
                    <tr>
                      <th>社員番号</th>
                      <th>氏名</th>
                      <th>面接指導の申出</th>
                      <th>統合ビュー</th>
                    </tr>
                  </thead>
                  <tbody>
                    {highStress.map((r, i) => (
                      <tr key={i}>
                        <td>{r.employee_no || "—"}</td>
                        <td>{r.full_name}</td>
                        <td>
                          {r.interview_requested ? (
                            <span className="badge orange">申出あり</span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          {r.user_id ? (
                            <Link href={`/office/${company.id}/person/${r.user_id}`}>
                              表示
                            </Link>
                          ) : (
                            <span className="muted">（アカウント未紐付け）</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted">この年度の高ストレス者はいません。</p>
              )}
              <p className="muted" style={{ marginTop: 10 }}>
                高ストレス者への面接指導は、企業ページの「＋ 面談予定を登録」から登録してください。
              </p>
            </div>
          </>
        )}
      </main>
    </>
  );
}
