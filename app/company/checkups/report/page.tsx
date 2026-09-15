import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/components/Header";
import CheckupReportPanel from "@/components/CheckupReportPanel";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getJudgmentRules } from "@/lib/judgmentRules";
import { getCheckupReportData } from "@/lib/checkupReportData";
import { getFiscalYear } from "@/lib/fiscal";
import { getOfficeInfo } from "@/lib/officeInfo";

export const dynamic = "force-dynamic";

// 定期健康診断結果報告書(様式第6号)の記入用サマリ (企業担当者向け)
export default async function CompanyCheckupReportPage({
  searchParams,
}: {
  searchParams: { year?: string; round?: string };
}) {
  const { profile } = await requireProfile();
  if (profile.role !== "company" || !profile.company_id) redirect("/");

  const supabase = createClient();
  const year = searchParams.year ? Number(searchParams.year) : getFiscalYear();
  const round = searchParams.round ? Number(searchParams.round) : undefined;
  // 互いに関係のない問い合わせは同時に行う(待ち時間の短縮)
  const [{ data: company }, { checkups, items }, officeInfo, rules] = await Promise.all([
    supabase.from("companies").select("id, name").eq("id", profile.company_id).single(),
    getCheckupReportData(profile.company_id, year, round),
    getOfficeInfo(),
    getJudgmentRules(),
  ]);

  await supabase.rpc("hm_log_access", {
    p_action: "report_summary",
    p_target_table: "hm_checkups",
    p_target_id: null,
    p_detail: { company_id: profile.company_id, fiscal_year: year },
  });

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href={`/company/checkups?year=${year}`}>← 健康診断管理に戻る</Link>
        </p>
        <h1 className="page-title">定期健康診断結果報告書（{year}年度{round ? `・第${round}回` : ""}）</h1>
        <div className="notice">
          労働基準監督署への報告は、厚生労働省の
          <a
            href="https://www.chohyo-shien.mhlw.go.jp/inputsupport/servlet/com.inputsupport.ksinrepo"
            target="_blank"
            rel="noopener noreferrer"
          >
            入力支援サービス
          </a>
          で行えます。下の数値をそのまま転記してください。
        </div>
        <div className="card">
          <CheckupReportPanel
            companyName={company?.name ?? ""}
            fiscalYear={year}
            checkups={checkups}
            items={items}
            officeInfo={officeInfo}
            rules={rules}
          />
        </div>
      </main>
    </>
  );
}
