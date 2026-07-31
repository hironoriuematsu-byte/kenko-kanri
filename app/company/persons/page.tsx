import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/components/Header";
import PersonsSection from "@/components/PersonsSection";
import { requireProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function CompanyPersonsPage() {
  const { profile } = await requireProfile();
  if (profile.role !== "company" || !profile.company_id) redirect("/");

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href="/company">← ダッシュボード</Link>
        </p>
        <h1 className="page-title">従業員カルテ</h1>
        <div className="card">
          <PersonsSection companyId={profile.company_id} basePath="/company/persons" />
        </div>
      </main>
    </>
  );
}
