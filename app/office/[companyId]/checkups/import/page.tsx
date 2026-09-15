import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import CheckupImport, { type UploadedCsv } from "@/components/CheckupImport";
import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getJudgmentRules } from "@/lib/judgmentRules";
import { getPersonCandidates } from "@/lib/personsForCompany";

export const dynamic = "force-dynamic";

export default async function OfficeCheckupImportPage({
  params,
  searchParams,
}: {
  params: { companyId: string };
  searchParams: { upload?: string };
}) {
  const supabase = createClient();
  const [{ profile }, { data: company }, rules, persons] = await Promise.all([
    requireProfile(),
    supabase.from("companies").select("id, name").eq("id", params.companyId).single(),
    getJudgmentRules(),
    getPersonCandidates(params.companyId),
  ]);
  if (profile.role !== "office") redirect("/");
  if (!company) notFound();

  // 事業者担当者から送られたCSV(ダッシュボードの「取り込む」から開いたとき)
  let upload: UploadedCsv | null = null;
  let uploadError: string | null = null;
  if (searchParams.upload) {
    const { data, error } = await supabase.rpc("hm_csv_upload_get", { p_id: searchParams.upload });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row) {
      uploadError = "送られたCSVが見つかりません（すでに取り込み済みか、破棄された可能性があります）。";
    } else if (row.status !== "pending" || !row.content) {
      uploadError = "このCSVはすでに取り込み済み（または破棄済み）です。";
    } else if (row.company_id !== company.id) {
      uploadError = "このCSVは別の企業から送られたものです。";
    } else {
      upload = {
        id: row.id,
        fileName: row.file_name,
        content: row.content,
        fiscalYear: row.fiscal_year ?? null,
        checkupType: row.checkup_type ?? null,
        round: row.round ?? 1,
        specialKind: row.special_kind ?? null,
        note: row.note ?? null,
        createdAt: row.created_at,
      };
    }
  }

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <h1 className="page-title">{company.name} — 健診結果CSV一括取込</h1>
        <p className="muted">
          <Link href="/office/judgment-criteria">判定基準の設定を確認・編集する</Link>
        </p>
        {uploadError && <p className="error-message">{uploadError}</p>}
        <div className="card">
          <CheckupImport
            companyId={company.id}
            backHref={`/office/${company.id}/checkups`}
            rules={rules}
            persons={persons}
            autoJudgeDefault
            upload={upload}
          />
        </div>
      </main>
    </>
  );
}
