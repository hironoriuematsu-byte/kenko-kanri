import { redirect } from "next/navigation";
import Header from "@/components/Header";
import CsvSubmit from "@/components/CsvSubmit";
import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadIkenState } from "@/lib/ikenData";
import { formatMdW, jstDateOf, receiptDate, returnDueDate } from "@/lib/businessDays";

export const dynamic = "force-dynamic";

// 事業者担当者は健診機関のCSVをそのまま産業医事務所に送る。
// どの列をどう取り込むかは産業医事務所が取込画面で指定する
export default async function CompanyCheckupImportPage() {
  const { profile } = await requireProfile();
  if (profile.role !== "company" || !profile.company_id) redirect("/");
  // 閲覧のみの担当者は登録・取込を行えない
  if (profile.view_only) redirect("/company");

  // 健診結果の医師意見聴取Web の事業場: その年度のお申込み(件数枠)がない間は送れない
  const iken = await loadIkenState(createClient(), profile.company_id);
  if (iken && iken.seats <= 0) {
    return (
      <>
        <Header profile={profile} />
        <main className="container">
          <h1 className="page-title">健康診断結果の送信（CSV・PDF）</h1>
          <div className="card">
            <p style={{ marginTop: 0 }}>
              {iken.fiscalYear}年度のお申込みがまだです。件数を入力してお支払いいただくと、健診結果を送れるようになります。
            </p>
            <Link href="/company/iken" className="btn orange">
              件数を入力して申し込む
            </Link>
          </div>
        </main>
      </>
    );
  }
  const now = new Date();

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <h1 className="page-title">健康診断結果の送信（CSV・PDF）</h1>
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>
            健診機関から受け取ったCSVまたはPDFをそのまま送ってください。産業医事務所が内容を
            確認して取り込み、就業判定を行います。取り込まれると健康診断管理の一覧に表示されます。
          </p>
          {iken && (
            <div className="notice" style={{ background: "var(--teal-light)", borderColor: "var(--teal)" }}>
              いま送ると{receiptDate(now) === jstDateOf(now) ? "本日" : ` ${formatMdW(receiptDate(now))} `}の受付となり、
              <strong>{formatMdW(returnDueDate(now))}まで</strong>に産業医の就業判定と意見をお返しします。
              夜勤・交替制の方、運転業務の方、特殊健診の対象業務など、医師に伝えたいことは連絡欄にご記入ください。
              {iken.used >= iken.seats && (
                <>
                  <br />
                  {iken.fiscalYear}年度のお申込み件数({iken.seats}件)に達しています。送る件数分を<Link href="/company/iken">追加</Link>してください。
                </>
              )}
            </div>
          )}
          <CsvSubmit companyId={profile.company_id} backHref="/company/checkups" />
        </div>
      </main>
    </>
  );
}
