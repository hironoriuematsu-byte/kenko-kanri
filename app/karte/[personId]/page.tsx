import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import PersonFilesPanel from "@/components/PersonFilesPanel";
import DeletePersonButton from "@/components/DeletePersonButton";
import { requireProfile, homePathFor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateJa } from "@/lib/fiscal";
import { CHECKUP_TYPES } from "@/lib/checkups";
import { DOC_TYPES, VISIBILITY_LABELS } from "@/lib/karte";
import {
  INTERVIEW_TYPES,
  INTERVIEW_STATUS,
  WORK_JUDGMENTS,
  formatDateTimeJa,
} from "@/lib/interviews";

export const dynamic = "force-dynamic";

// 従業員カルテ: 基本情報+書類+産業医文書+健診/面談履歴を1画面に集約
export default async function KartePage({ params }: { params: { personId: string } }) {
  const { profile } = await requireProfile();
  const supabase = createClient();

  const { data: person } = await supabase
    .from("hm_persons")
    .select(
      "id, company_id, user_id, full_name, kana, employee_no, birth_date, department, note, companies(name)"
    )
    .eq("id", params.personId)
    .single();
  if (!person) notFound();

  const isOffice = profile.role === "office";
  const isCompany = profile.role === "company" && profile.company_id === person.company_id;
  if (!isOffice && !isCompany) redirect(homePathFor(profile.role));

  await supabase.rpc("hm_log_access", {
    p_action: "view",
    p_target_table: "hm_persons",
    p_target_id: person.id,
  });

  // 健診・面談履歴(アカウント紐付け or 同一企業内の同姓同名で照合)
  const checkupByUser = person.user_id
    ? supabase
        .from("hm_checkups")
        .select("id, fiscal_year, checkup_type, checkup_date, overall_judgment, has_findings, work_judgment")
        .eq("target_user_id", person.user_id)
    : null;
  const interviewByUser = person.user_id
    ? supabase
        .from("hm_interviews")
        .select("id, interview_type, scheduled_at, status")
        .eq("target_user_id", person.user_id)
    : null;

  const [files, documents, checkupsA, checkupsB, interviewsA, interviewsB] =
    await Promise.all([
      supabase
        .from("hm_person_files")
        .select("id, category, file_name, storage_path, note, visibility, uploaded_by, created_at")
        .eq("person_id", person.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("hm_person_documents")
        .select("id, doc_type, title, addressee, issued_date, visibility")
        .eq("person_id", person.id)
        .order("created_at", { ascending: false }),
      checkupByUser ?? Promise.resolve({ data: [] as any[] }),
      supabase
        .from("hm_checkups")
        .select("id, fiscal_year, checkup_type, checkup_date, overall_judgment, has_findings, work_judgment")
        .eq("company_id", person.company_id)
        .eq("target_name", person.full_name),
      interviewByUser ?? Promise.resolve({ data: [] as any[] }),
      supabase
        .from("hm_interviews")
        .select("id, interview_type, scheduled_at, status")
        .eq("company_id", person.company_id)
        .eq("target_name", person.full_name),
    ]);

  const dedupe = <T extends { id: string }>(...lists: (T[] | null | undefined)[]) => {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const list of lists) {
      for (const item of list ?? []) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          out.push(item);
        }
      }
    }
    return out;
  };
  const checkups = dedupe((checkupsA as any).data, (checkupsB as any).data).sort(
    (a: any, b: any) => b.fiscal_year - a.fiscal_year
  );
  const interviews = dedupe((interviewsA as any).data, (interviewsB as any).data).sort(
    (a: any, b: any) => ((a.scheduled_at ?? "") < (b.scheduled_at ?? "") ? 1 : -1)
  );

  const companyName = (person as any).companies?.name ?? "";

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href={isOffice ? `/office/${person.company_id}/persons` : "/company/persons"}>
            ← 従業員カルテ一覧
          </Link>
        </p>
        <h1 className="page-title">
          カルテ: {person.full_name}
          <span className="muted" style={{ fontSize: 14, marginLeft: 10 }}>
            {companyName}
          </span>
        </h1>

        <div className="card">
          <h2>基本情報</h2>
          <table className="list">
            <tbody>
              <tr>
                <th style={{ width: 130 }}>氏名</th>
                <td>
                  {person.full_name}
                  {person.kana && <span className="muted">（{person.kana}）</span>}
                </td>
                <th style={{ width: 130 }}>社員番号</th>
                <td>{person.employee_no || "—"}</td>
              </tr>
              <tr>
                <th>生年月日</th>
                <td>{formatDateJa(person.birth_date)}</td>
                <th>部署</th>
                <td>{person.department || "—"}</td>
              </tr>
              {person.note && (
                <tr>
                  <th>備考</th>
                  <td colSpan={3} style={{ whiteSpace: "pre-wrap" }}>
                    {person.note}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <Link className="btn secondary" href={`/karte/${person.id}/edit`}>
              基本情報を編集
            </Link>
            {isOffice && person.user_id && (
              <Link
                className="btn secondary"
                href={`/office/${person.company_id}/person/${person.user_id}`}
              >
                統合ビュー（ストレスチェック含む）
              </Link>
            )}
            {isOffice && (
              <DeletePersonButton
                personId={person.id}
                personName={person.full_name}
                backHref={`/office/${person.company_id}/persons`}
              />
            )}
          </div>
        </div>

        <div className="card">
          <h2>書類（診断書・診療情報提供書など）</h2>
          {isOffice && (
            <p className="muted">
              公開範囲を「産業医事務所のみ」にした書類は、企業側には一切表示されません。
            </p>
          )}
          <PersonFilesPanel
            personId={person.id}
            companyId={person.company_id}
            initialFiles={(files.data as any[]) ?? []}
            role={isOffice ? "office" : "company"}
            currentUserId={profile.id}
          />
        </div>

        <div className="card">
          <h2>産業医の作成文書（診療情報提供依頼書など）</h2>
          {isOffice && (
            <p>
              <Link className="btn orange" href={`/karte/${person.id}/documents/new`}>
                ＋ 文書を作成
              </Link>
            </p>
          )}
          {((documents.data as any[]) ?? []).length > 0 ? (
            <table className="list">
              <thead>
                <tr>
                  <th>表題</th>
                  <th>種類</th>
                  <th>宛先</th>
                  <th>発行日</th>
                  {isOffice && <th>公開範囲</th>}
                </tr>
              </thead>
              <tbody>
                {((documents.data as any[]) ?? []).map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link href={`/document/${d.id}`}>{d.title}</Link>
                    </td>
                    <td>{DOC_TYPES[d.doc_type] ?? d.doc_type}</td>
                    <td className="muted">{d.addressee ?? "—"}</td>
                    <td>{formatDateJa(d.issued_date)}</td>
                    {isOffice && (
                      <td>
                        {d.visibility === "office_only" ? (
                          <span className="badge orange">
                            {VISIBILITY_LABELS[d.visibility]}
                          </span>
                        ) : (
                          <span className="badge">{VISIBILITY_LABELS[d.visibility]}</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">
              作成文書はまだありません。
              {isCompany && "（産業医事務所が作成・共有すると表示されます）"}
            </p>
          )}
        </div>

        <div className="card">
          <h2>健診・面談の履歴</h2>
          {checkups.length > 0 || interviews.length > 0 ? (
            <table className="list">
              <thead>
                <tr>
                  <th style={{ width: 170 }}>日付</th>
                  <th style={{ width: 90 }}>区分</th>
                  <th>内容</th>
                </tr>
              </thead>
              <tbody>
                {checkups.map((c: any) => (
                  <tr key={`c-${c.id}`}>
                    <td>
                      {c.checkup_date ? formatDateJa(c.checkup_date) : `${c.fiscal_year}年度`}
                    </td>
                    <td>
                      <span className={c.has_findings ? "badge orange" : "badge"}>健診</span>
                    </td>
                    <td>
                      <Link href={`/checkup/${c.id}`}>
                        {CHECKUP_TYPES[c.checkup_type] ?? c.checkup_type} 総合判定{" "}
                        {c.overall_judgment || "—"}
                        {c.has_findings && "（有所見）"}
                        {c.work_judgment && ` / 就業判定: ${WORK_JUDGMENTS[c.work_judgment]}`}
                      </Link>
                    </td>
                  </tr>
                ))}
                {interviews.map((iv: any) => (
                  <tr key={`i-${iv.id}`}>
                    <td>{formatDateTimeJa(iv.scheduled_at)}</td>
                    <td>
                      <span className="badge">面談</span>
                    </td>
                    <td>
                      <Link href={`/interviews/${iv.id}`}>
                        {INTERVIEW_TYPES[iv.interview_type] ?? iv.interview_type}（
                        {INTERVIEW_STATUS[iv.status] ?? iv.status}）
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">
              健診・面談の記録はまだありません（氏名またはアカウントの一致で自動的に紐付きます）。
            </p>
          )}
        </div>
      </main>
    </>
  );
}
