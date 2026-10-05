import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import CheckupNoticesView from "@/components/CheckupNoticesView";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadCheckupList } from "@/lib/checkupList";
import { needsAttention } from "@/lib/checkups";
import { getCompanyAddress } from "@/lib/noticeData";
import { NOTICE_TEMPLATES, type NoticeKind } from "@/lib/notice";

// 従業員への通知書(1人1ページ・まとめて印刷/PDF)。実施者向け。
// 受診勧奨通知(notices)と産業医面談通知(interview-notices)で別の画面にし、kind だけ変えて使う
export default async function OfficeNoticePage({
  kind,
  params,
  searchParams,
}: {
  kind: NoticeKind;
  params: { companyId: string };
  searchParams: { year?: string; round?: string };
}) {
  const tpl = NOTICE_TEMPLATES[kind];
  const supabase = createClient();
  const year = searchParams.year ? Number(searchParams.year) : undefined;
  const round = searchParams.round ? Number(searchParams.round) : undefined;
  const [{ profile }, { data: company }, data, companyAddress] = await Promise.all([
    requireProfile(),
    supabase.from("companies").select("id, name").eq("id", params.companyId).single(),
    loadCheckupList(params.companyId, year, round),
    getCompanyAddress(params.companyId),
  ]);
  if (profile.role !== "office") redirect("/");
  if (!company || !data.year) notFound();

  // 対象者はあらかじめ絞り込む: 就業判定が確定した方(未判定・判定保留を除く)のうち、通知の種類の条件に合う方
  const rows = data.list.filter((c) => !needsAttention(c.work_judgment) && tpl.isTarget(c));

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
          {company.name} — {tpl.label}書の作成（{data.year}年度）
        </h1>
        <CheckupNoticesView
          kind={kind}
          companyName={company.name}
          companyAddress={companyAddress}
          officeInfo={data.officeInfo}
          fiscalYear={data.year}
          round={data.rounds.length > 1 ? data.round : undefined}
          rows={rows}
          canFollowup
          canFillOpinion
        />
      </main>
    </>
  );
}
