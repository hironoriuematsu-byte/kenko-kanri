import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import MinutesForm from "@/components/MinutesForm";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function NewMinutesPage({
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
      .select("committee_name, default_attendees")
      .eq("company_id", params.companyId)
      .maybeSingle(),
  ]);
  if (!company) notFound();

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <h1 className="page-title">{company.name} — 議事録の作成</h1>
        <div className="card">
          <MinutesForm
            backHref={`/office/${company.id}/minutes`}
            initial={{
              company_id: company.id,
              meeting_date: new Date().toISOString().slice(0, 10),
              title: info?.committee_name ?? "安全衛生委員会",
              attendees: info?.default_attendees ?? "",
              agenda: "",
              published_to_employees: false,
            }}
          />
        </div>
      </main>
    </>
  );
}
