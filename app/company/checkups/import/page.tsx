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
        <h1 className="page-title">健康診断結果の送信（CSV・PDF）</h1>
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>
            健診機関から受け取ったCSVまたはPDFを、そのまま送ってください。送るとその場で自動で読み取り、
            産業医があらかじめ定めた基準で判定して、就業判定を表示します。読み取りに確認が必要な方と、
            就業制限の検討が必要な方は、産業医事務所が確認してから結果をお返しします。
          </p>
          <CsvSubmit companyId={profile.company_id} backHref="/company/checkups" />
        </div>
      </main>
    </>
  );
}
