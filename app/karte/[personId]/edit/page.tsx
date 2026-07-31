import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import PersonForm from "@/components/PersonForm";
import { requireProfile, homePathFor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function KarteEditPage({ params }: { params: { personId: string } }) {
  const { profile } = await requireProfile();
  const supabase = createClient();

  const { data: person } = await supabase
    .from("hm_persons")
    .select("id, company_id, user_id, full_name, kana, employee_no, birth_date, department, note")
    .eq("id", params.personId)
    .single();
  if (!person) notFound();

  const isOffice = profile.role === "office";
  const isCompany = profile.role === "company" && profile.company_id === person.company_id;
  if (!isOffice && !isCompany) redirect(homePathFor(profile.role));

  const { data: employees } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("company_id", person.company_id)
    .eq("role", "employee")
    .order("full_name");

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <h1 className="page-title">カルテ基本情報の編集: {person.full_name}</h1>
        <div className="card">
          <PersonForm
            employees={employees ?? []}
            backHref={`/karte/${person.id}`}
            initial={{
              id: person.id,
              company_id: person.company_id,
              user_id: person.user_id,
              full_name: person.full_name,
              kana: person.kana ?? "",
              employee_no: person.employee_no ?? "",
              birth_date: person.birth_date ?? "",
              department: person.department ?? "",
              note: person.note ?? "",
            }}
          />
        </div>
      </main>
    </>
  );
}
