import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import PatrolsTable from "@/components/PatrolsTable";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { groupYearsBy } from "@/lib/minutesYears";

export const dynamic = "force-dynamic";

export default async function OfficePatrolsPage({
  params,
  searchParams,
}: {
  params: { companyId: string };
  searchParams: { year?: string };
}) {
  const { profile } = await requireProfile();
  if (profile.role !== "office") redirect("/");

  const supabase = createClient();
  const [{ data: company }, { data: patrols }] = await Promise.all([
    supabase.from("companies").select("id, name").eq("id", params.companyId).single(),
    supabase
      .from("hm_patrols")
      .select("id, patrol_date, areas, findings, advice, note, physician_name")
      .eq("company_id", params.companyId)
      .order("patrol_date", { ascending: false }),
  ]);
  if (!company) notFound();

  const { years, byYear } = groupYearsBy(patrols ?? [], (p) => p.patrol_date);
  const selectedYear = searchParams.year ? Number(searchParams.year) : years[0];
  const list = selectedYear != null ? (byYear.get(selectedYear) ?? []) : [];

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href={`/office/${company.id}`}>← {company.name}</Link>
        </p>
        <h1 className="page-title">{company.name} — 産業医巡視記録</h1>
        <div className="card">
          <p style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link className="btn orange" href={`/office/${company.id}/patrols/new`}>
              ＋ 巡視記録を作成
            </Link>
            {selectedYear != null && (
              <Link
                className="btn"
                href={`/office/${company.id}/patrols/report?year=${selectedYear}`}
              >
                {selectedYear}年度をまとめて印刷/PDF
              </Link>
            )}
          </p>

          {years.length > 0 && (
            <p style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span className="muted">年度:</span>
              {years.map((y) => (
                <Link
                  key={y}
                  href={`/office/${company.id}/patrols?year=${y}`}
                  className={y === selectedYear ? "badge" : ""}
                  style={y === selectedYear ? {} : { padding: "2px 8px" }}
                >
                  {y}年度
                </Link>
              ))}
            </p>
          )}

          <PatrolsTable patrols={list} />
        </div>
      </main>
    </>
  );
}
