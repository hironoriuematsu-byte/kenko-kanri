import { redirect } from "next/navigation";
import Header from "@/components/Header";
import CsvSubmit from "@/components/CsvSubmit";
import { requireProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

// 事業者担当者は健診機関のCSVをそのまま産業医事務所に送る。
// どの列をどう取り込むかは産業医事務所が取込画面で指定する
export default async function CompanyCheckupImportPage() {
  const { profile } = await requireProfile();
  if (profile.role !== "company" || !profile.company_id) redirect("/");
  // 閲覧のみの担当者は登録・取込を行えない
  if (profile.view_only) redirect("/company");

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <h1 className="page-title">健診結果の送信（CSV・PDF）</h1>
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>
            健診機関から受け取ったCSVまたはPDFをそのまま送ってください。産業医事務所が内容を
            確認して取り込み、就業判定を行います。取り込まれると健康診断管理の一覧に表示されます。
          </p>
          <CsvSubmit companyId={profile.company_id} backHref="/company/checkups" />
        </div>
      </main>
    </>
  );
}
