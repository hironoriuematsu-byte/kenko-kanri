import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import HygienePatrolsTable from "@/components/HygienePatrolsTable";
import ChecklistSettingsForm from "@/components/ChecklistSettingsForm";
import DefaultInspectorForm from "@/components/DefaultInspectorForm";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const RECENT_LIMIT = 10;

export default async function OfficeHygienePatrolsPage({
  params,
  searchParams,
}: {
  params: { companyId: string };
  searchParams: { all?: string };
}) {
  const { profile } = await requireProfile();
  if (profile.role !== "office") redirect("/");

  const showAll = searchParams.all === "1";
  const supabase = createClient();
  const [{ data: company }, { data: patrols, count }, { data: items }, { data: info }] =
    await Promise.all([
      supabase.from("companies").select("id, name").eq("id", params.companyId).single(),
      showAll
        ? supabase
            .from("hm_hygiene_patrols")
            .select("id, patrol_date, checklist_type, inspector_name, results", {
              count: "exact",
            })
            .eq("company_id", params.companyId)
            .order("patrol_date", { ascending: false })
        : supabase
            .from("hm_hygiene_patrols")
            .select("id, patrol_date, checklist_type, inspector_name, results", {
              count: "exact",
            })
            .eq("company_id", params.companyId)
            .order("patrol_date", { ascending: false })
            .limit(RECENT_LIMIT),
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
  const total = count ?? (patrols ?? []).length;

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
            <Link className="btn" href={`/office/${company.id}/hygiene-patrols/report`}>
              直近10件をまとめて印刷/PDF
            </Link>
          </p>
          <HygienePatrolsTable patrols={(patrols as any[]) ?? []} />
          {!showAll && total > RECENT_LIMIT && (
            <p style={{ marginTop: 10 }}>
              <Link href={`/office/${company.id}/hygiene-patrols?all=1`}>
                過去の記録も表示する（全{total}件）
              </Link>
            </p>
          )}
          {showAll && (
            <p style={{ marginTop: 10 }}>
              <Link href={`/office/${company.id}/hygiene-patrols`}>直近10件のみ表示に戻す</Link>
            </p>
          )}
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
