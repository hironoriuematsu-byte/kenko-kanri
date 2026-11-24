import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import InterviewForm from "@/components/InterviewForm";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SITUATION_OPINION, isOpinionOnly } from "@/lib/interviews";

export const dynamic = "force-dynamic";

export default async function NewInterviewPage({
  params,
  searchParams,
}: {
  params: { companyId: string };
  searchParams?: { person?: string; type?: string };
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

  // カルテの「状況から産業医意見書を作成」から来たとき: 対象者と種別を入れた状態で開く
  const opinionOnly = isOpinionOnly(searchParams?.type);
  const preset = (persons ?? []).find((x) => x.id === searchParams?.person) ?? null;
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());

  // 申出の確認の印(SQL 0159)が使えるか。列がまだ無ければ、チェック欄を出さない
  const { error: confirmErr } = await supabase.from("hm_interviews").select("request_confirmed").limit(1);
  const confirmReady = !confirmErr;

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <h1 className="page-title">
          {company.name} — {opinionOnly ? "状況に基づく産業医意見の作成（面談なし）" : "面談予定の登録"}
        </h1>
        <div className="card">
          <InterviewForm
            mode="office"
            persons={persons ?? []}
            backHref={preset ? `/karte/${preset.id}` : `/office/${company.id}/interviews`}
            confirmReady={confirmReady}
            initial={{
              company_id: company.id,
              person_id: preset?.id ?? null,
              target_user_id: preset?.user_id ?? null,
              target_name: preset?.full_name ?? "",
              birth_date: "",
              // 種類は必ず選んでもらう(「高ストレス面接指導」のまま登録してしまう誤りを防ぐ)
              // (面談なしの産業医意見は、カルテから種別を指定して開く)
              interview_type: opinionOnly ? SITUATION_OPINION : "",
              scheduled_local: opinionOnly ? today : "",
              method: "",
              location: "",
            }}
          />
        </div>
      </main>
    </>
  );
}
