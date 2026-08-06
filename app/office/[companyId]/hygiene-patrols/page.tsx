import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import HygienePatrolsTable from "@/components/HygienePatrolsTable";
import ChecklistSettingsForm from "@/components/ChecklistSettingsForm";
import DefaultInspectorForm from "@/components/DefaultInspectorForm";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { groupYearsBy } from "@/lib/minutesYears";

export const dynamic = "force-dynamic";

export default async function OfficeHygienePatrolsPage({
  params,
  searchParams,
}: {
  params: { companyId: string };
  searchParams: { year?: string };
}) {
  const { profile } = await requireProfile();
  if (profile.role !== "office") redirect("/");

  const supabase = createClient();
  const [{ data: company }, { data: patrols }, { data: items }, { data: info }] =
    await Promise.all([
      supabase.from("companies").select("id, name").eq("id", params.companyId).single(),
      supabase
        .from("hm_hygiene_patrols")
        .select("id, patrol_date, checklist_type, inspector_name, results")
        .eq("company_id", params.companyId)
        .order("patrol_date", { ascending: false }),
      supabase
        .from("hm_checklist_items")
        .select("checklist_type, item_text, sort_order")
        .eq("company_id", params.companyId)
        .order("sort_order"),
      supabase
        .from("hm_company_info")
        .select("default_inspector_name")
        .eq("company_id", params.companyId)
        .maybeSingle(),
    ]);
  if (!company) notFound();

  const configured = {
    factory: (items ?? [])
      .filter((r) => r.checklist_type === "factory")
      .map((r) => r.item_text),
    office: (items ?? [])
      .filter((r) => r.checklist_type === "office")
      .map((r) => r.item_text),
  };

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
        <h1 className="page-title">{company.name} — 衛生管理者巡視記録</h1>
        <div className="card">
          <p style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link className="btn orange" href={`/office/${company.id}/hygiene-patrols/new`}>
              ＋ 巡視記録を作成
            </Link>
            {selectedYear != null && (
              <Link
                className="btn"
                href={`/office/${company.id}/hygiene-patrols/report?year=${selectedYear}`}
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
                  href={`/office/${company.id}/hygiene-patrols?year=${y}`}
                  className={y === selectedYear ? "badge" : ""}
                  style={y === selectedYear ? {} : { padding: "2px 8px" }}
                >
                  {y}年度
                </Link>
              ))}
            </p>
          )}

          <HygienePatrolsTable patrols={list as any[]} />
        </div>

        <div className="card">
          <h2>設定</h2>
          <DefaultInspectorForm
            companyId={company.id}
            initial={info?.default_inspector_name ?? ""}
          />
          <h2>チェックリスト項目の設定</h2>
          <ChecklistSettingsForm companyId={company.id} initial={configured} />
        </div>
      </main>
    </>
  );
}
