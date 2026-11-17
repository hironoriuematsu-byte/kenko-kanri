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
    .select("id, full_name, kana, employee_no, department, user_id")
    .eq("company_id", company.id)
    .order("employee_no", { ascending: true, nullsFirst: false })
    .order("full_name");

  // 申出の確認の印(SQL 0159)が使えるか。列がまだ無ければ、チェック欄を出さない
  const { error: confirmErr } = await supabase.from("hm_interviews").select("request_confirmed").limit(1);
  const confirmReady = !confirmErr;

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
            confirmReady={confirmReady}
            initial={{
              company_id: company.id,
              person_id: null,
              target_user_id: null,
              target_name: "",
              birth_date: "",
              // 種類は必ず選んでもらう(「高ストレス面接指導」のまま登録してしまう誤りを防ぐ)
              interview_type: "",
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
