import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/components/Header";
import PatrolsTable from "@/components/PatrolsTable";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { groupYearsBy } from "@/lib/minutesYears";

export const dynamic = "force-dynamic";

export default async function CompanyPatrolsPage({
  searchParams,
}: {
  searchParams: { year?: string };
}) {
  const { profile } = await requireProfile();
  if (profile.role !== "company" || !profile.company_id) redirect("/");

  const supabase = createClient();
  const { data: patrols } = await supabase
    .from("hm_patrols")
    .select("id, patrol_date, areas, findings, advice, note, physician_name")
    .eq("company_id", profile.company_id)
    .order("patrol_date", { ascending: false });

  const { years, byYear } = groupYearsBy(patrols ?? [], (p) => p.patrol_date);
  const selectedYear = searchParams.year ? Number(searchParams.year) : years[0];
  const list = selectedYear != null ? (byYear.get(selectedYear) ?? []) : [];

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href="/company">← ダッシュボード</Link>
        </p>
        <h1 className="page-title">産業医巡視記録</h1>
        <div className="card">
          {selectedYear != null && (
            <p>
              <Link className="btn" href={`/company/patrols/report?year=${selectedYear}`}>
                {selectedYear}年度をまとめて印刷/PDF
              </Link>
            </p>
          )}

          {years.length > 0 && (
            <p style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span className="muted">年度:</span>
              {years.map((y) => (
                <Link
                  key={y}
                  href={`/company/patrols?year=${y}`}
                  className={y === selectedYear ? "badge" : ""}
                  style={y === selectedYear ? {} : { padding: "2px 8px" }}
                >
                  {y}年度
                </Link>
              ))}
            </p>
          )}

          <PatrolsTable patrols={list} />
          <p className="muted" style={{ marginTop: 10 }}>
            巡視記録は産業医事務所が作成します。
          </p>
        </div>
      </main>
    </>
  );
}
