import { redirect } from "next/navigation";
import Header from "@/components/Header";
import CheckupImport from "@/components/CheckupImport";
import { requireProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function CompanyCheckupImportPage() {
  const { profile } = await requireProfile();
  if (profile.role !== "company" || !profile.company_id) redirect("/");

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <h1 className="page-title">健診結果CSV一括取込</h1>
        <div className="card">
          <CheckupImport companyId={profile.company_id} backHref="/company/checkups" />
        </div>
      </main>
    </>
  );
}
