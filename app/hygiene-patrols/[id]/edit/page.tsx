import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import HygienePatrolForm from "@/components/HygienePatrolForm";
import { requireProfile, homePathFor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { type ChecklistResult } from "@/lib/hygiene";

export const dynamic = "force-dynamic";

export default async function HygienePatrolEditPage({
  params,
}: {
  params: { id: string };
}) {
  const { profile } = await requireProfile();
  const supabase = createClient();

  const { data: p } = await supabase
    .from("hm_hygiene_patrols")
    .select(
      "id, company_id, patrol_date, checklist_type, inspector_name, results, summary, companies(name)"
    )
    .eq("id", params.id)
    .single();
  if (!p) notFound();

  const isOffice = profile.role === "office";
  const isCompany = profile.role === "company" && profile.company_id === p.company_id;
  if (!isOffice && !isCompany) redirect(homePathFor(profile.role));

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <h1 className="page-title">
          {(p as any).companies?.name ?? ""} — 衛生管理者巡視記録の編集
        </h1>
        <div className="card">
          <HygienePatrolForm
            itemsByType={{}}
            backHref={`/hygiene-patrols/${p.id}`}
            initial={{
              id: p.id,
              company_id: p.company_id,
              patrol_date: p.patrol_date ?? "",
              checklist_type: p.checklist_type,
              inspector_name: p.inspector_name ?? "",
              results: (p.results as ChecklistResult[]) ?? [],
              summary: p.summary ?? "",
            }}
          />
        </div>
      </main>
    </>
  );
}
