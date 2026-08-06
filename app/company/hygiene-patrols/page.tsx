import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/components/Header";
import HygienePatrolsTable from "@/components/HygienePatrolsTable";
import ChecklistSettingsForm from "@/components/ChecklistSettingsForm";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CompanyHygienePatrolsPage() {
  const { profile } = await requireProfile();
  if (profile.role !== "company" || !profile.company_id) redirect("/");

  const supabase = createClient();
  const [{ data: patrols }, { data: items }] = await Promise.all([
    supabase
      .from("hm_hygiene_patrols")
      .select("id, patrol_date, checklist_type, inspector_name, results")
      .eq("company_id", profile.company_id)
      .order("patrol_date", { ascending: false }),
    supabase
      .from("hm_checklist_items")
      .select("checklist_type, item_text, sort_order")
      .eq("company_id", profile.company_id)
      .order("sort_order"),
  ]);

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
          <Link href="/company">← ダッシュボード</Link>
        </p>
        <h1 className="page-title">衛生管理者巡視記録</h1>
        <div className="card">
          <p>
            <Link className="btn orange" href="/company/hygiene-patrols/new">
              ＋ 巡視記録を作成
            </Link>
          </p>
          <HygienePatrolsTable patrols={(patrols as any[]) ?? []} />
        </div>

        <div className="card">
          <h2>チェックリスト項目の設定</h2>
          <ChecklistSettingsForm companyId={profile.company_id} initial={configured} />
        </div>
      </main>
    </>
  );
}
