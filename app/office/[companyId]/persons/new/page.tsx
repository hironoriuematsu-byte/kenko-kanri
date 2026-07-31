import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import PersonForm from "@/components/PersonForm";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OfficePersonNewPage({
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
        <h1 className="page-title">{company.name} — 従業員カルテの作成</h1>
        <div className="card">
          <PersonForm
            employees={employees ?? []}
            backHref={`/office/${company.id}/persons`}
            initial={{
              company_id: company.id,
              user_id: null,
              full_name: "",
              kana: "",
              employee_no: "",
              birth_date: "",
              department: "",
              note: "",
            }}
          />
        </div>
      </main>
    </>
  );
}
