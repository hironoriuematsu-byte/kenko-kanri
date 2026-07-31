import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/components/Header";
import InterviewsTable from "@/components/InterviewsTable";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CompanyInterviewsPage() {
  const { profile } = await requireProfile();
  if (profile.role !== "company" || !profile.company_id) redirect("/");

  const supabase = createClient();
  const { data: interviews } = await supabase
    .from("hm_interviews")
    .select("id, target_name, interview_type, scheduled_at, method, status")
    .eq("company_id", profile.company_id)
    .order("scheduled_at", { ascending: false, nullsFirst: false });

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href="/company">← ダッシュボード</Link>
        </p>
        <h1 className="page-title">産業医面談管理</h1>
        <div className="card">
          <InterviewsTable interviews={interviews ?? []} />
          <p className="muted" style={{ marginTop: 10 }}>
            日程の調整・事前情報の記入は各面談の詳細画面から行えます。産業医の意見書は公開され次第、詳細画面に表示されます。
          </p>
        </div>
      </main>
    </>
  );
}
