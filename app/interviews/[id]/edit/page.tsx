import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import InterviewForm from "@/components/InterviewForm";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { toDatetimeLocal } from "@/lib/interviews";

export const dynamic = "force-dynamic";

export default async function EditInterviewPage({ params }: { params: { id: string } }) {
  const { profile } = await requireProfile();
  const supabase = createClient();

  const { data: iv } = await supabase
    .from("hm_interviews")
    .select(
      "id, company_id, person_id, target_user_id, target_name, interview_type, scheduled_at, method, location, status, companies(name)"
    )
    .eq("id", params.id)
    .single();
  if (!iv) notFound();

  const isOffice = profile.role === "office";
  const isCompany = profile.role === "company" && profile.company_id === iv.company_id;
  if ((!isOffice && !isCompany) || iv.status !== "scheduled") {
    redirect(`/interviews/${iv.id}`);
  }

  const { data: persons } = isOffice
    ? await supabase
        .from("hm_persons")
        .select("id, full_name, employee_no, user_id")
        .eq("company_id", iv.company_id)
        .order("employee_no", { ascending: true, nullsFirst: false })
        .order("full_name")
    : { data: [] };

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <h1 className="page-title">
          {(iv as any).companies?.name ?? ""} — {isOffice ? "面談予定の編集" : "日程調整"}
        </h1>
        {isCompany && (
          <div className="notice">
            日時・実施方法・場所のみ変更できます。変更内容は産業医事務所にも共有されます。
          </div>
        )}
        <div className="card">
          <InterviewForm
            mode={isOffice ? "office" : "company"}
            persons={persons ?? []}
            backHref={`/interviews/${iv.id}`}
            initial={{
              id: iv.id,
              company_id: iv.company_id,
              person_id: iv.person_id,
              target_user_id: iv.target_user_id,
              target_name: iv.target_name,
              birth_date: "",
              interview_type: iv.interview_type,
              scheduled_local: toDatetimeLocal(iv.scheduled_at),
              method: iv.method ?? "",
              location: iv.location ?? "",
            }}
          />
        </div>
      </main>
    </>
  );
}
