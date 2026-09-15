import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import CheckupsSection from "@/components/CheckupsSection";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OfficeCheckupsPage({
  params,
  searchParams,
}: {
  params: { companyId: string };
  searchParams: { year?: string; round?: string };
}) {
  const supabase = createClient();
  // ログイン確認と企業の取得は同時に行う(待ち時間の短縮)
  const [{ profile }, { data: company }] = await Promise.all([
    requireProfile(),
    supabase.from("companies").select("id, name").eq("id", params.companyId).single(),
  ]);
  if (profile.role !== "office") redirect("/");
  if (!company) notFound();

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href={`/office/${company.id}`}>← {company.name}</Link>
        </p>
        <h1 className="page-title">{company.name} — 健康診断管理</h1>
        <div className="card">
          <CheckupsSection
            companyId={company.id}
            companyName={company.name}
            basePath={`/office/${company.id}/checkups`}
            selectedYear={searchParams.year ? Number(searchParams.year) : undefined}
            selectedRound={searchParams.round ? Number(searchParams.round) : undefined}
            canEdit
            canDelete
            canJudge
          />
        </div>
      </main>
    </>
  );
}
