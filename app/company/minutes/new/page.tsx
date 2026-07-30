import { redirect } from "next/navigation";
import Header from "@/components/Header";
import MinutesForm from "@/components/MinutesForm";
import { requireProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function CompanyNewMinutesPage() {
  const { profile } = await requireProfile();
  if (profile.role !== "company" || !profile.company_id) redirect("/");

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <h1 className="page-title">議事録の作成</h1>
        <div className="card">
          <MinutesForm
            backHref="/company"
            initial={{
              company_id: profile.company_id,
              meeting_date: new Date().toISOString().slice(0, 10),
              title: "安全衛生委員会",
              attendees: "",
              physician_attended: false,
              agenda: "",
              decisions: "",
              next_meeting_date: "",
              next_meeting_note: "",
              published_to_employees: false,
            }}
          />
        </div>
      </main>
    </>
  );
}
