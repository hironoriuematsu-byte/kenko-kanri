import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import HygienePatrolsTable from "@/components/HygienePatrolsTable";
import ChecklistSettingsForm from "@/components/ChecklistSettingsForm";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OfficeHygienePatrolsPage({
  params,
}: {
  params: { companyId: string };
}) {
  const { profile } = await requireProfile();
  if (profile.role !== "office") redirect("/");

  const supabase = createClient();
  const [{ data: company }, { data: patrols }, { data: items }] = await Promise.all([
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

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href={`/office/${company.id}`}>← {company.name}</Link>
        </p>
        <h1 className="page-title">{company.name} — 衛生管理者巡視記録</h1>
        <div className="card">
          <p>
            <Link className="btn orange" href={`/office/${company.id}/hygiene-patrols/new`}>
              ＋ 巡視記録を作成
            </Link>
          </p>
          <HygienePatrolsTable patrols={(patrols as any[]) ?? []} />
        </div>

        <div className="card">
          <h2>チェックリスト項目の設定</h2>
          <ChecklistSettingsForm companyId={company.id} initial={configured} />
        </div>
      </main>
    </>
  );
}
