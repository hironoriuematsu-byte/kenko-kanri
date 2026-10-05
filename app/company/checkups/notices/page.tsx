import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/components/Header";
import CheckupNoticesView from "@/components/CheckupNoticesView";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadCheckupList } from "@/lib/checkupList";
import { needsAttention } from "@/lib/checkups";
import { getCompanyAddress } from "@/lib/noticeData";
import { NOTICE_TEMPLATES, noticeKindOf } from "@/lib/notice";

export const dynamic = "force-dynamic";

// 受診勧奨通知書(事業者担当者向け: 1人1ページ・まとめて印刷/PDF)
export default async function CompanyCheckupNoticesPage({
  searchParams,
}: {
  searchParams: { year?: string; round?: string; kind?: string };
}) {
  const { profile } = await requireProfile();
  if (profile.role !== "company" || !profile.company_id) redirect("/");

  const supabase = createClient();
  const year = searchParams.year ? Number(searchParams.year) : undefined;
  const round = searchParams.round ? Number(searchParams.round) : undefined;
  const kind = noticeKindOf(searchParams.kind);
  const [{ data: company }, data, companyAddress] = await Promise.all([
    supabase.from("companies").select("id, name").eq("id", profile.company_id).single(),
    loadCheckupList(profile.company_id, year, round),
    getCompanyAddress(profile.company_id),
  ]);
  if (!data.year) redirect("/company/checkups");

  // 就業判定が確定した方(未判定・判定保留を除く)だけを候補にする
  const rows = data.list.filter((c) => !needsAttention(c.work_judgment));

  await supabase.rpc("hm_log_access", {
    p_action: "checkup_notices",
    p_target_table: "hm_checkups",
    p_target_id: null,
    p_detail: { company_id: profile.company_id, fiscal_year: data.year, round: data.round, kind, candidates: rows.length },
  });

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted no-print">
          <Link href={`/company/checkups?year=${data.year}${data.roundQuery}`}>← 健康診断管理に戻る</Link>
        </p>
        <h1 className="page-title no-print">{NOTICE_TEMPLATES[kind].label}書の作成（{data.year}年度）</h1>
        <div className="notice no-print">
          {kind === "interview"
            ? "産業医の就業判定で産業医面談が必要となった従業員へ、面談を案内する文書です。"
            : "産業医の就業判定で受診勧奨となった従業員へ、医療機関の受診を案内する文書です。"}
          対象者を確認し、文面を調整してから印刷またはPDF保存し、ご本人にお渡しください。
        </div>
        {/* key: タブ(通知の種類)を切り替えたら文面などの入力状態を作り直す */}
        <CheckupNoticesView
          key={kind}
          kind={kind}
          tabBasePath={`/company/checkups/notices?year=${data.year}${data.roundQuery}`}
          companyName={company?.name ?? ""}
          companyAddress={companyAddress}
          officeInfo={data.officeInfo}
          fiscalYear={data.year}
          round={data.rounds.length > 1 ? data.round : undefined}
          rows={rows}
          canFollowup={!profile.view_only}
        />
      </main>
    </>
  );
}
