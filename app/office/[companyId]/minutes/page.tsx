import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import MinutesTable from "@/components/MinutesTable";
import MinutesSettingsForm from "@/components/MinutesSettingsForm";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { groupYears } from "@/lib/minutesYears";

export const dynamic = "force-dynamic";

export default async function OfficeMinutesPage({
  params,
  searchParams,
}: {
  params: { companyId: string };
  searchParams: { year?: string };
}) {
  const { profile } = await requireProfile();
  if (profile.role !== "office") redirect("/");

  const supabase = createClient();
  const [{ data: company }, { data: minutes }, { data: info }] = await Promise.all([
    supabase.from("companies").select("id, name").eq("id", params.companyId).single(),
    supabase
      .from("hm_minutes")
      .select("id, meeting_date, title, published_to_employees")
      .eq("company_id", params.companyId)
      .order("meeting_date", { ascending: false }),
    supabase
      .from("hm_company_info")
      .select("committee_name, default_attendees")
      .eq("company_id", params.companyId)
      .maybeSingle(),
  ]);
  if (!company) notFound();

  const { years, byYear } = groupYears(minutes ?? []);
  const selectedYear = searchParams.year ? Number(searchParams.year) : years[0];
  const list = selectedYear != null ? (byYear.get(selectedYear) ?? []) : [];

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href={`/office/${company.id}`}>← {company.name}</Link>
        </p>
        <h1 className="page-title">
          {company.name} — {info?.committee_name ?? "安全衛生委員会"}議事録
        </h1>
        <div className="card">
          <p style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link className="btn orange" href={`/office/${company.id}/minutes/new`}>
              ＋ 議事録を作成
            </Link>
            {selectedYear != null && (
              <Link
                className="btn"
                href={`/office/${company.id}/minutes/report?year=${selectedYear}`}
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
                  href={`/office/${company.id}/minutes?year=${y}`}
                  className={y === selectedYear ? "badge" : ""}
                  style={y === selectedYear ? {} : { padding: "2px 8px" }}
                >
                  {y}年度
                </Link>
              ))}
            </p>
          )}

          <MinutesTable minutes={list} />
        </div>

        <div className="card">
          <h2>議事録の設定</h2>
          <MinutesSettingsForm
            companyId={company.id}
            initial={{
              committee_name: info?.committee_name ?? "",
              default_attendees: info?.default_attendees ?? "",
            }}
          />
        </div>
      </main>
    </>
  );
}
