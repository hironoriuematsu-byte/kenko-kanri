import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import CheckupImport from "@/components/CheckupImport";
import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getJudgmentRules } from "@/lib/judgmentRules";

export const dynamic = "force-dynamic";

export default async function OfficeCheckupImportPage({
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

  const rules = await getJudgmentRules();

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <h1 className="page-title">{company.name} — 健診結果CSV一括取込</h1>
        <p className="muted">
          <Link href="/office/judgment-criteria">判定基準の設定を確認・編集する</Link>
        </p>
        <div className="card">
          <CheckupImport
            companyId={company.id}
            backHref={`/office/${company.id}/checkups`}
            rules={rules}
            autoJudgeDefault
          />
        </div>
      </main>
    </>
  );
}
