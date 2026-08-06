import { redirect } from "next/navigation";
import Header from "@/components/Header";
import HygienePatrolForm from "@/components/HygienePatrolForm";
import { requireProfile } from "@/lib/auth";
import { getChecklistItems } from "@/lib/checklistItems";

export const dynamic = "force-dynamic";

export default async function CompanyHygienePatrolNewPage() {
  const { profile } = await requireProfile();
  if (profile.role !== "company" || !profile.company_id) redirect("/");

  const { itemsByType } = await getChecklistItems(profile.company_id);

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <h1 className="page-title">衛生管理者巡視記録の作成</h1>
        <div className="card">
          <HygienePatrolForm
            itemsByType={itemsByType}
            backHref="/company/hygiene-patrols"
            initial={{
              company_id: profile.company_id,
              patrol_date: new Date().toISOString().slice(0, 10),
              checklist_type: "office",
              inspector_name: profile.full_name ?? "",
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
