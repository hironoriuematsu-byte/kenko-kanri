import { redirect } from "next/navigation";
import Header from "@/components/Header";
import CheckupImport from "@/components/CheckupImport";
import { requireProfile } from "@/lib/auth";
import { getJudgmentRules } from "@/lib/judgmentRules";
import { getPersonCandidates } from "@/lib/personsForCompany";

export const dynamic = "force-dynamic";

export default async function CompanyCheckupImportPage() {
  const { profile } = await requireProfile();
  if (profile.role !== "company" || !profile.company_id) redirect("/");
  // 閲覧のみの担当者は登録・取込を行えない
  if (profile.view_only) redirect("/company");

  const rules = await getJudgmentRules();
  const persons = await getPersonCandidates(profile.company_id);

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <h1 className="page-title">健診結果CSV一括取込</h1>
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>
            健診機関から受け取ったCSVを選んで取り込んでください。取込が完了すると産業医事務所に通知され、
            産業医が内容を確認して就業判定を行います。
          </p>
          <CheckupImport
            companyId={profile.company_id}
            backHref="/company/checkups"
            rules={rules}
            persons={persons}
            autoJudgeDefault
            simple
          />
        </div>
      </main>
    </>
  );
}
