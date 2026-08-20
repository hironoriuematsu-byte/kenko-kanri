import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import CheckupReportPanel from "@/components/CheckupReportPanel";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCheckupReportData } from "@/lib/checkupReportData";
import { getFiscalYear } from "@/lib/fiscal";
import { getOfficeInfo } from "@/lib/officeInfo";

export const dynamic = "force-dynamic";

// 定期健康診断結果報告書(様式第6号)の記入用サマリ
export default async function OfficeCheckupReportPage({
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
  const { checkups, items } = await getCheckupReportData(company.id, year);

  const officeInfo = await getOfficeInfo();

  await supabase.rpc("hm_log_access", {
    p_action: "report_summary",
    p_target_table: "hm_checkups",
    p_target_id: null,
    p_detail: { company_id: company.id, fiscal_year: year },
  });

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href={`/office/${company.id}/checkups?year=${year}`}>← 健康診断管理に戻る</Link>
        </p>
        <h1 className="page-title">
          {company.name} — 定期健康診断結果報告書（{year}年度）
        </h1>
        <div className="card">
          <CheckupReportPanel
            companyName={company.name}
            fiscalYear={year}
            checkups={checkups}
            items={items}
            officeInfo={officeInfo}
          />
        </div>
      </main>
    </>
  );
}
