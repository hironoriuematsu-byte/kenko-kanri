import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import CheckupNoticesView from "@/components/CheckupNoticesView";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadCheckupList } from "@/lib/checkupList";
import { needsAttention } from "@/lib/checkups";
import { getCompanyAddress } from "@/lib/noticeData";
import { NOTICE_TEMPLATES, noticeKindOf } from "@/lib/notice";

export const dynamic = "force-dynamic";

// 受診勧奨通知書(1人1ページ・まとめて印刷/PDF)。実施者向け
export default async function OfficeCheckupNoticesPage({
  params,
  searchParams,
}: {
  params: { companyId: string };
  searchParams: { year?: string; round?: string; kind?: string };
}) {
  const supabase = createClient();
  const year = searchParams.year ? Number(searchParams.year) : undefined;
  const round = searchParams.round ? Number(searchParams.round) : undefined;
  const kind = noticeKindOf(searchParams.kind);
  const [{ profile }, { data: company }, data, companyAddress] = await Promise.all([
    requireProfile(),
    supabase.from("companies").select("id, name").eq("id", params.companyId).single(),
    loadCheckupList(params.companyId, year, round),
    getCompanyAddress(params.companyId),
  ]);
  if (profile.role !== "office") redirect("/");
  if (!company || !data.year) notFound();

  // 就業判定が確定した方(未判定・判定保留を除く)だけを候補にする
  const rows = data.list.filter((c) => !needsAttention(c.work_judgment));

  await supabase.rpc("hm_log_access", {
    p_action: "checkup_notices",
    p_target_table: "hm_checkups",
    p_target_id: null,
    p_detail: { company_id: company.id, fiscal_year: data.year, round: data.round, kind, candidates: rows.length },
  });

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted no-print">
          <Link href={`/office/${company.id}/checkups?year=${data.year}${data.roundQuery}`}>← 健康診断管理に戻る</Link>
        </p>
        <h1 className="page-title no-print">
          {company.name} — {NOTICE_TEMPLATES[kind].label}書の作成（{data.year}年度）
        </h1>
        {/* key: タブ(通知の種類)を切り替えたら文面などの入力状態を作り直す */}
        <CheckupNoticesView
          key={kind}
          kind={kind}
          tabBasePath={`/office/${company.id}/checkups/notices?year=${data.year}${data.roundQuery}`}
          companyName={company.name}
          companyAddress={companyAddress}
          officeInfo={data.officeInfo}
          fiscalYear={data.year}
          round={data.rounds.length > 1 ? data.round : undefined}
          rows={rows}
          canFollowup
        />
      </main>
    </>
  );
}
