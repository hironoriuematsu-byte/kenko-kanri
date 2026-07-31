import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import PatrolForm from "@/components/PatrolForm";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OfficePatrolNewPage({
  params,
}: {
  params: { companyId: string };
}) {
  const { profile } = await requireProfile();
  if (profile.role !== "office") redirect("/");

  const supabase = createClient();
  const { data: company } = await supabase
    .from("companies")
    .select("id, name")
    .eq("id", params.companyId)
    .single();
  if (!company) notFound();

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <h1 className="page-title">{company.name} — 巡視記録の作成</h1>
        <div className="card">
          <PatrolForm
            physicianName={profile.full_name ?? ""}
            backHref={`/office/${company.id}/patrols`}
            initial={{
              company_id: company.id,
              patrol_date: new Date().toISOString().slice(0, 10),
              findings: "",
            }}
          />
        </div>
      </main>
    </>
  );
}
