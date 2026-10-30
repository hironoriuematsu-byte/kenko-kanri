import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import CheckupsSection from "@/components/CheckupsSection";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadIkenState } from "@/lib/ikenData";
import { businessDaysLeft, formatMdW } from "@/lib/businessDays";
import IkenReturnButton from "@/components/IkenReturnButton";

export const dynamic = "force-dynamic";

export default async function OfficeCheckupsPage({
  params,
  searchParams,
}: {
  params: { companyId: string };
  searchParams: { year?: string; round?: string; group?: string };
}) {
  const supabase = createClient();
  // ログイン確認と企業の取得は同時に行う(待ち時間の短縮)
  const [{ profile }, { data: company }] = await Promise.all([
    requireProfile(),
    supabase.from("companies").select("id, name").eq("id", params.companyId).single(),
  ]);
  if (profile.role !== "office") redirect("/");
  if (!company) notFound();
  // 健診結果の医師意見聴取Web の事業場: 業務内容(意見の前提)・返却期限・件数を判定画面の上に出す
  const iken = await loadIkenState(supabase, company.id);
  const openJobs = iken ? iken.jobs.filter((j) => !j.returned_at) : [];
  const due = openJobs.map((j) => j.due).sort()[0];

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href={`/office/${company.id}`}>← {company.name}</Link>
        </p>
        <h1 className="page-title">{company.name} — 健康診断管理</h1>
        {iken && (
          <div className="card" style={{ borderColor: "var(--orange)" }}>
            <h2>医師意見聴取Web(Web申込の事業場)</h2>
            <table className="list kv">
              <tbody>
                <tr>
                  <th style={{ whiteSpace: "nowrap" }}>業務内容・勤務形態</th>
                  <td style={{ whiteSpace: "pre-wrap" }}>{iken.info.work_info ?? "(未入力)"}</td>
                </tr>
                <tr>
                  <th>労働者数</th>
                  <td>{iken.info.workers ?? "—"}名</td>
                </tr>
                <tr>
                  <th>{iken.fiscalYear}年度の件数</th>
                  <td style={{ color: iken.used > iken.seats ? "var(--danger)" : undefined }}>
                    使用 {iken.used} / 申込 {iken.seats}
                    {iken.used > iken.seats && "(超過。担当者に追加を依頼)"}
                  </td>
                </tr>
                <tr>
                  <th>担当者</th>
                  <td>
                    {iken.info.contact_name}({iken.info.contact_email}
                    {iken.info.contact_phone ? ` / ${iken.info.contact_phone}` : ""})
                  </td>
                </tr>
                <tr>
                  <th>返却</th>
                  <td>
                    {due ? (
                      <>
                        未返却 {openJobs.length}ファイル・期限 <strong>{formatMdW(due)}</strong>
                        ({businessDaysLeft(due) < 0 ? `${-businessDaysLeft(due)}営業日超過` : businessDaysLeft(due) === 0 ? "本日まで" : `あと${businessDaysLeft(due)}営業日`}){" "}
                        <IkenReturnButton companyId={company.id} companyName={company.name} unjudged={0} />
                      </>
                    ) : (
                      "未返却の健診結果はありません"
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <div className="card">
          <CheckupsSection
            companyId={company.id}
            companyName={company.name}
            basePath={`/office/${company.id}/checkups`}
            selectedYear={searchParams.year ? Number(searchParams.year) : undefined}
            selectedRound={searchParams.round ? Number(searchParams.round) : undefined}
            selectedGroup={searchParams.group}
            canEdit
            canDelete
            canJudge
          />
        </div>
      </main>
    </>
  );
}
