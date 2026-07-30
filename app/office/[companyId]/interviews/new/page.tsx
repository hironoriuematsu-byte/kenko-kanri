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

  const { data: employees } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("company_id", company.id)
    .eq("role", "employee")
    .order("full_name");

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <h1 className="page-title">{company.name} — 面談予定の登録</h1>
        <div className="card">
          <InterviewForm
            mode="office"
            employees={employees ?? []}
            backHref={`/office/${company.id}`}
            initial={{
              company_id: company.id,
              target_user_id: null,
              target_name: "",
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
