import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/components/Header";
import PneumoRegister from "@/components/PneumoRegister";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadPneumo } from "@/lib/pneumoServer";

export const dynamic = "force-dynamic";

// じん肺健康管理台帳(事業者担当者向け)。管理区分の決定通知は事業者に届くため、担当者も入力できる
export default async function CompanyPneumoPage() {
  const { profile } = await requireProfile();
  if (profile.role !== "company" || !profile.company_id) redirect("/");
  const supabase = createClient();
  const [{ data: company }, pneumo] = await Promise.all([
    supabase.from("companies").select("id, name").eq("id", profile.company_id).single(),
    loadPneumo(profile.company_id),
  ]);
  await supabase.rpc("hm_log_access", { p_action: "view", p_target_table: "hm_pneumo_workers", p_target_id: null, p_detail: { company_id: profile.company_id } });

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href="/company/checkups/report?form=pneumo">← じん肺（様式第8号）の集計に戻る</Link>
        </p>
        <h1 className="page-title">じん肺健康管理台帳{company?.name ? `: ${company.name}` : ""}</h1>
        <div className="card">
          {pneumo.ready ? (
            <PneumoRegister companyId={profile.company_id} initialWorkers={pneumo.workers} initialExams={pneumo.exams} />
          ) : (
            <p className="muted">じん肺健康管理台帳の準備がまだです。産業医事務所にお問い合わせください。</p>
          )}
        </div>
      </main>
    </>
  );
}
