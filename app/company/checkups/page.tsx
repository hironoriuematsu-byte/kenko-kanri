import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/components/Header";
import CheckupsSection from "@/components/CheckupsSection";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CompanyCheckupsPage({
  searchParams,
}: {
  searchParams: { year?: string };
}) {
  const { profile } = await requireProfile();
  if (profile.role !== "company" || !profile.company_id) redirect("/");

  const supabase = createClient();
  const { data: company } = await supabase
    .from("companies")
    .select("name")
    .eq("id", profile.company_id)
    .maybeSingle();

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href="/company">← ダッシュボード</Link>
        </p>
        <h1 className="page-title">健康診断管理</h1>
        <div className="card">
          <CheckupsSection
            companyId={profile.company_id}
            companyName={company?.name ?? "自社"}
            basePath="/company/checkups"
            selectedYear={searchParams.year ? Number(searchParams.year) : undefined}
            canEdit
          />
        </div>
      </main>
    </>
  );
}
