import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import InterviewsTable from "@/components/InterviewsTable";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OfficeInterviewsPage({
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

  const { data: interviews } = await supabase
    .from("hm_interviews")
    .select("id, target_name, interview_type, scheduled_at, method, status")
    .eq("company_id", company.id)
    .order("scheduled_at", { ascending: false, nullsFirst: false });

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href={`/office/${company.id}`}>← {company.name}</Link>
        </p>
        <h1 className="page-title">{company.name} — 産業医面談管理</h1>
        <div className="card">
          <p>
            <Link className="btn orange" href={`/office/${company.id}/interviews/new`}>
              ＋ 面談予定を登録
            </Link>
          </p>
          <InterviewsTable interviews={interviews ?? []} />
        </div>
      </main>
    </>
  );
}
