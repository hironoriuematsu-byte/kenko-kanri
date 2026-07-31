import { redirect } from "next/navigation";
import Header from "@/components/Header";
import PersonForm from "@/components/PersonForm";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CompanyPersonNewPage() {
  const { profile } = await requireProfile();
  if (profile.role !== "company" || !profile.company_id) redirect("/");

  const supabase = createClient();
  const { data: employees } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("company_id", profile.company_id)
    .eq("role", "employee")
    .order("full_name");

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <h1 className="page-title">従業員カルテの作成</h1>
        <div className="card">
          <PersonForm
            employees={employees ?? []}
            backHref="/company/persons"
            initial={{
              company_id: profile.company_id,
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
