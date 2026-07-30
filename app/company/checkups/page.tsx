import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/components/Header";
import CheckupsSection from "@/components/CheckupsSection";
import { requireProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function CompanyCheckupsPage({
  searchParams,
}: {
  searchParams: { year?: string };
}) {
  const { profile } = await requireProfile();
  if (profile.role !== "company" || !profile.company_id) redirect("/");

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href="/company">← ダッシュボード</Link>
        </p>
        <h1 className="page-title">健康診断結果</h1>
        <div className="card">
          <CheckupsSection
            companyId={profile.company_id}
            basePath="/company/checkups"
            selectedYear={searchParams.year ? Number(searchParams.year) : undefined}
            canEdit
          />
        </div>
      </main>
    </>
  );
}
