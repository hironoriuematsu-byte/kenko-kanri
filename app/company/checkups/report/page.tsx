import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import Form6Sheet from "@/components/Form6Sheet";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadCheckupList } from "@/lib/checkupList";

export const dynamic = "force-dynamic";

// 労基署報告(定期健康診断結果報告書 様式第6号)の転記用集計(企業担当者向け・印刷/PDF保存)
export default async function CompanyCheckupReportPage({ searchParams }: { searchParams: { year?: string; round?: string } }) {
  const { profile } = await requireProfile();
  if (profile.role !== "company" || !profile.company_id) redirect("/");

  const supabase = createClient();
  const year = searchParams.year ? Number(searchParams.year) : undefined;
  const round = searchParams.round ? Number(searchParams.round) : undefined;
  const [{ data: company }, data] = await Promise.all([
    supabase.from("companies").select("id, name").eq("id", profile.company_id).single(),
    loadCheckupList(profile.company_id, year, round),
  ]);
  if (!data.year) notFound();

  await supabase.rpc("hm_log_access", {
    p_action: "report_summary",
    p_target_table: "hm_checkups",
    p_target_id: null,
    p_detail: { company_id: profile.company_id, fiscal_year: data.year, round: data.round },
  });

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted no-print">
          <Link href={`/company/checkups?year=${data.year}${data.roundQuery}`}>← 健康診断管理に戻る</Link>
        </p>
        <div className="card">
          <Form6Sheet
            variant="sheet"
            companyName={company?.name ?? ""}
            fiscalYear={data.year}
            round={data.rounds.length > 1 ? data.round : undefined}
            stats={data.stats}
            form6={data.form6}
            officeInfo={data.officeInfo}
          />
        </div>
      </main>
    </>
  );
}
