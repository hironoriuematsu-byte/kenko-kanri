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
  searchParams: { year?: string };
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

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href={`/office/${company.id}`}>← {company.name}</Link>
        </p>
        <h1 className="page-title">{company.name} — 健康診断結果</h1>
        <div className="card">
          <CheckupsSection
            companyId={company.id}
            basePath={`/office/${company.id}/checkups`}
            selectedYear={searchParams.year ? Number(searchParams.year) : undefined}
            canEdit
            canDelete
          />
        </div>
      </main>
    </>
  );
}
