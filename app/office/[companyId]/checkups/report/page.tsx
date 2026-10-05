import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import Form6Sheet from "@/components/Form6Sheet";
import ReportTabs, { type ReportForm } from "@/components/ReportTabs";
import { ChemicalReportSheet, OrganicReportSheet } from "@/components/SpecialReportSheet";
import { loadSpecialReport } from "@/lib/specialReport";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadCheckupList } from "@/lib/checkupList";

export const dynamic = "force-dynamic";

// 労基署報告(定期健康診断結果報告書 様式第6号)の転記用集計(実施者向け・印刷/PDF保存)
export default async function OfficeCheckupReportPage({
  params,
  searchParams,
}: {
  params: { companyId: string };
  searchParams: { year?: string; round?: string; form?: string };
}) {
  const supabase = createClient();
  const year = searchParams.year ? Number(searchParams.year) : undefined;
  const round = searchParams.round ? Number(searchParams.round) : undefined;
  const [{ profile }, { data: company }, data] = await Promise.all([
    requireProfile(),
    supabase.from("companies").select("id, name").eq("id", params.companyId).single(),
    loadCheckupList(params.companyId, year, round, "regular"),
  ]);
  if (profile.role !== "office") redirect("/");
  if (!company || !data.year) notFound();
  // 特殊健診(有機溶剤・特定化学物質)の報告書用の集計。様式はクエリ form で切り替える
  const form: ReportForm = searchParams.form === "organic" || searchParams.form === "chemical" ? searchParams.form : "6";
  const special = await loadSpecialReport(company.id, data.year, round);

  await supabase.rpc("hm_log_access", {
    p_action: "report_summary",
    p_target_table: "hm_checkups",
    p_target_id: null,
    p_detail: { company_id: company.id, fiscal_year: data.year, round: data.round, form },
  });

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted no-print">
          <Link href={`/office/${company.id}/checkups?year=${data.year}${data.roundQuery}`}>← 健康診断管理に戻る</Link>
        </p>
        <div className="card">
          <ReportTabs
            basePath={`/office/${company.id}/checkups/report?year=${data.year}`}
            current={form}
            counts={{ regular: data.form6.regularCount, organic: special.organicTotal, chemical: special.chemicalTotal }}
            rounds={form === "organic" ? special.organicRounds : form === "chemical" ? special.chemicalRounds : data.rounds}
            round={form === "organic" ? special.organicRound : form === "chemical" ? special.chemicalRound : data.round}
          />
          {form === "organic" ? (
            <OrganicReportSheet companyName={company.name} fiscalYear={data.year} round={special.organicRounds.length > 1 ? special.organicRound : undefined} report={special.organic} officeInfo={data.officeInfo} />
          ) : form === "chemical" ? (
            <ChemicalReportSheet companyName={company.name} fiscalYear={data.year} round={special.chemicalRounds.length > 1 ? special.chemicalRound : undefined} report={special.chemical} officeInfo={data.officeInfo} />
          ) : (
            <Form6Sheet
              variant="sheet"
              companyName={company.name}
              fiscalYear={data.year}
              round={data.rounds.length > 1 ? data.round : undefined}
              stats={data.stats}
              form6={data.form6}
              officeInfo={data.officeInfo}
            />
          )}
          {special.otherKinds.length > 0 && (
            <p className="muted no-print" style={{ fontSize: 12 }}>
              この年度には「{special.otherKinds.join("・")}」の特殊健診も取り込まれています（これらの様式には対応していません）。
            </p>
          )}
        </div>
      </main>
    </>
  );
}
