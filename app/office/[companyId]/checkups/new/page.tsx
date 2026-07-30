import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import CheckupForm from "@/components/CheckupForm";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OfficeCheckupNewPage({
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

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <h1 className="page-title">{company.name} — 健診結果の個別入力</h1>
        <div className="card">
          <CheckupForm companyId={company.id} backHref={`/office/${company.id}/checkups`} />
        </div>
      </main>
    </>
  );
}
