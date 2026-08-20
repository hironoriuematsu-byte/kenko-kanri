import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import InterviewForm from "@/components/InterviewForm";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function NewInterviewPage({
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

  const { data: persons } = await supabase
    .from("hm_persons")
    .select("id, full_name, employee_no, user_id")
    .eq("company_id", company.id)
    .order("employee_no", { ascending: true, nullsFirst: false })
    .order("full_name");

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <h1 className="page-title">{company.name} — 面談予定の登録</h1>
        <div className="card">
          <InterviewForm
            mode="office"
            persons={persons ?? []}
            backHref={`/office/${company.id}/interviews`}
            initial={{
              company_id: company.id,
              person_id: null,
              target_user_id: null,
              target_name: "",
              birth_date: "",
              interview_type: "high_stress",
              scheduled_local: "",
              method: "",
              location: "",
            }}
          />
        </div>
      </main>
    </>
  );
}
