import { redirect } from "next/navigation";
import Header from "@/components/Header";
import CheckupForm from "@/components/CheckupForm";
import { requireProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function CompanyCheckupNewPage() {
  const { profile } = await requireProfile();
  if (profile.role !== "company" || !profile.company_id) redirect("/");

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <h1 className="page-title">健診結果の個別入力</h1>
        <div className="card">
          <CheckupForm companyId={profile.company_id} backHref="/company/checkups" />
        </div>
      </main>
    </>
  );
}
