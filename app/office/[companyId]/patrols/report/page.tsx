import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import PrintButton from "@/components/PrintButton";
import PatrolSheet from "@/components/PatrolSheet";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fiscalYearOf } from "@/lib/minutesYears";
import { getFiscalYear } from "@/lib/fiscal";

export const dynamic = "force-dynamic";

// 年度内の産業医巡視記録をまとめて表示・印刷/PDF
export default async function OfficePatrolsReportPage({
  params,
  searchParams,
}: {
  params: { companyId: string };
  searchParams: { year?: string };
}) {
  const { profile } = await requireProfile();
  if (profile.role !== "office") redirect("/");

  const year = searchParams.year ? Number(searchParams.year) : getFiscalYear();
  const supabase = createClient();
  const [{ data: company }, { data: allPatrols }] = await Promise.all([
    supabase.from("companies").select("id, name").eq("id", params.companyId).single(),
    supabase
      .from("hm_patrols")
      .select("id, patrol_date, areas, findings, advice, note, physician_name")
      .eq("company_id", params.companyId)
      .order("patrol_date", { ascending: true }),
  ]);
  if (!company) notFound();

  const patrols = (allPatrols ?? []).filter((p) => fiscalYearOf(p.patrol_date) === year);

  await supabase.rpc("hm_log_access", {
    p_action: "print_batch",
    p_target_table: "hm_patrols",
    p_target_id: null,
    p_detail: { company_id: company.id, fiscal_year: year, count: patrols.length },
  });

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <div
          className="no-print"
          style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}
        >
          <Link className="muted" href={`/office/${company.id}/patrols?year=${year}`}>
            ← 一覧に戻る
          </Link>
          <PrintButton />
          <span className="muted">
            {year}年度の巡視記録 {patrols.length}件を表示しています。
          </span>
        </div>

        {patrols.length === 0 ? (
          <div className="card">
            <p className="muted">{year}年度の巡視記録はありません。</p>
          </div>
        ) : (
          patrols.map((p) => (
            <div className="card sheet-break" key={p.id}>
              <PatrolSheet patrol={p} companyName={company.name} />
            </div>
          ))
        )}
      </main>
    </>
  );
}
