import { redirect } from "next/navigation";
import Header from "@/components/Header";
import MinutesForm from "@/components/MinutesForm";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CompanyNewMinutesPage() {
  const { profile } = await requireProfile();
  if (profile.role !== "company" || !profile.company_id) redirect("/");

  const supabase = createClient();
  const { data: info } = await supabase
    .from("hm_company_info")
    .select("committee_name, default_attendees")
    .eq("company_id", profile.company_id)
    .maybeSingle();

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <h1 className="page-title">議事録の作成</h1>
        <div className="card">
          <MinutesForm
            backHref="/company/minutes"
            initial={{
              company_id: profile.company_id,
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
