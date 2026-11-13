import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import WorkJudgmentSheet from "@/components/WorkJudgmentSheet";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadCheckupList } from "@/lib/checkupList";

export const dynamic = "force-dynamic";

// 就業判定・事後措置報告書(実施者向け・印刷/PDF保存)
export default async function OfficeWorkJudgmentPage({
  params,
  searchParams,
}: {
  params: { companyId: string };
  searchParams: { year?: string; round?: string; group?: string };
}) {
  const supabase = createClient();
  const year = searchParams.year ? Number(searchParams.year) : undefined;
  const round = searchParams.round ? Number(searchParams.round) : undefined;
  const [{ profile }, { data: company }, data] = await Promise.all([
    requireProfile(),
    supabase.from("companies").select("id, name").eq("id", params.companyId).single(),
    loadCheckupList(params.companyId, year, round, searchParams.group),
  ]);
  if (profile.role !== "office") redirect("/");
  if (!company || !data.year) notFound();
  await supabase.rpc("hm_log_access", {
    p_action: "export_work_judgment",
    p_target_table: "hm_checkups",
    p_target_id: null,
    p_detail: { company_id: company.id, fiscal_year: data.year, round: data.round, format: "pdf", rows: data.list.length },
  });

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted no-print">
          <Link href={`/office/${company.id}/checkups?year=${data.year}${data.roundQuery}${data.groupQuery}`}>← 健康診断管理に戻る</Link>
        </p>
        <div className="card">
          <WorkJudgmentSheet
            companyName={company.name}
            fiscalYear={data.year}
            round={data.rounds.length > 1 ? data.round : undefined}
            groupLabel={data.group && data.groups.length > 1 ? data.group.label : undefined}
            rows={data.list}
            officeInfo={data.officeInfo}
          />
        </div>
      </main>
    </>
  );
}
