import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import PneumoRegister from "@/components/PneumoRegister";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadPneumo } from "@/lib/pneumoServer";

export const dynamic = "force-dynamic";

// じん肺健康管理台帳(実施者向け)。じん肺健康管理実施状況報告(様式第8号)の集計のもとになる
export default async function OfficePneumoPage({ params }: { params: { companyId: string } }) {
  const supabase = createClient();
  const [{ profile }, { data: company }, pneumo] = await Promise.all([
    requireProfile(),
    supabase.from("companies").select("id, name").eq("id", params.companyId).single(),
    loadPneumo(params.companyId),
  ]);
  if (profile.role !== "office") redirect("/");
  if (!company) notFound();
  await supabase.rpc("hm_log_access", { p_action: "view", p_target_table: "hm_pneumo_workers", p_target_id: null, p_detail: { company_id: company.id } });

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href={`/office/${company.id}/checkups/report?form=pneumo`}>← じん肺（様式第8号）の集計に戻る</Link>
        </p>
        <h1 className="page-title">じん肺健康管理台帳: {company.name}</h1>
        <div className="card">
          {pneumo.ready ? (
            <PneumoRegister companyId={company.id} initialWorkers={pneumo.workers} initialExams={pneumo.exams} checkups={pneumo.checkups} />
          ) : (
            <p className="muted">じん肺健康管理台帳の準備（SQL 0153 の実行）がまだです。</p>
          )}
        </div>
      </main>
    </>
  );
}
