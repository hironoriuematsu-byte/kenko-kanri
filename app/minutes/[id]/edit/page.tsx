import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import MinutesForm from "@/components/MinutesForm";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function EditMinutesPage({ params }: { params: { id: string } }) {
  const { profile } = await requireProfile();
  const supabase = createClient();

  const { data: m } = await supabase
    .from("hm_minutes")
    .select(
      "id, company_id, meeting_date, title, attendees, agenda, published_to_employees, companies(name)"
    )
    .eq("id", params.id)
    .single();
  if (!m) notFound();

  const canEdit =
    profile.role === "office" ||
    (profile.role === "company" && profile.company_id === m.company_id);
  if (!canEdit) redirect(`/minutes/${m.id}`);

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <h1 className="page-title">
          {(m as any).companies?.name ?? ""} — 議事録の編集
        </h1>
        <div className="card">
          <MinutesForm
            backHref={`/minutes/${m.id}`}
            initial={{
              id: m.id,
              company_id: m.company_id,
              meeting_date: m.meeting_date ?? "",
              title: m.title ?? "",
              attendees: m.attendees ?? "",
              agenda: m.agenda ?? "",
              published_to_employees: !!m.published_to_employees,
            }}
          />
        </div>
      </main>
    </>
  );
}
