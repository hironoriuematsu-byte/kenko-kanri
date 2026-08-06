import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import HygienePatrolForm from "@/components/HygienePatrolForm";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getChecklistItems } from "@/lib/checklistItems";

export const dynamic = "force-dynamic";

export default async function OfficeHygienePatrolNewPage({
  params,
}: {
  params: { companyId: string };
}) {
  const { profile } = await requireProfile();
  if (profile.role !== "office") redirect("/");

  const supabase = createClient();
  const [{ data: company }, { data: info }] = await Promise.all([
    supabase.from("companies").select("id, name").eq("id", params.companyId).single(),
    supabase
      .from("hm_company_info")
      .select("default_inspector_name")
      .eq("company_id", params.companyId)
      .maybeSingle(),
  ]);
  if (!company) notFound();

  const { itemsByType } = await getChecklistItems(company.id);

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <h1 className="page-title">{company.name} — 衛生管理者巡視記録の作成</h1>
        <div className="card">
          <HygienePatrolForm
            itemsByType={itemsByType}
            backHref={`/office/${company.id}/hygiene-patrols`}
            initial={{
              company_id: company.id,
              patrol_date: new Date().toISOString().slice(0, 10),
              checklist_type: "office",
              inspector_name: info?.default_inspector_name ?? "",
              results: itemsByType.office.map((item) => ({
                item,
                result: "ok",
                note: "",
              })),
              summary: "",
            }}
          />
        </div>
      </main>
    </>
  );
}
