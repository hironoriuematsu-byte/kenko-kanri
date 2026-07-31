import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import PrintButton from "@/components/PrintButton";
import { requireProfile, homePathFor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateJa } from "@/lib/fiscal";
import { DOC_TYPES, VISIBILITY_LABELS } from "@/lib/karte";

export const dynamic = "force-dynamic";

// 産業医作成文書の表示・印刷(診療情報提供依頼書など)
export default async function DocumentPage({ params }: { params: { id: string } }) {
  const { profile } = await requireProfile();
  if (profile.role !== "office" && profile.role !== "company") {
    redirect(homePathFor(profile.role));
  }

  const supabase = createClient();
  const { data: doc } = await supabase
    .from("hm_person_documents")
    .select(
      "id, person_id, company_id, doc_type, title, addressee, body, issued_date, physician_name, visibility, hm_persons(full_name, employee_no, birth_date), companies(name)"
    )
    .eq("id", params.id)
    .single();
  if (!doc) notFound();

  await supabase.rpc("hm_log_access", {
    p_action: "view",
    p_target_table: "hm_person_documents",
    p_target_id: doc.id,
  });

  const { data: companyInfo } = await supabase
    .from("hm_company_info")
    .select("address, tel")
    .eq("company_id", doc.company_id)
    .maybeSingle();

  const person = (doc as any).hm_persons;
  const companyName = (doc as any).companies?.name ?? "";
  const isOffice = profile.role === "office";

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted no-print">
          <Link href={`/karte/${doc.person_id}`}>← カルテに戻る</Link>
        </p>

        <div className="card print-sheet">
          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <h1 style={{ fontSize: 20, margin: 0 }}>{doc.title}</h1>
          </div>

          {doc.addressee && <p>{doc.addressee}　御机下</p>}

          <table className="list" style={{ marginBottom: 16, maxWidth: 560 }}>
            <tbody>
              <tr>
                <th style={{ width: 120 }}>対象者氏名</th>
                <td>{person?.full_name ?? "—"}</td>
              </tr>
              <tr>
                <th>生年月日</th>
                <td>{formatDateJa(person?.birth_date)}</td>
              </tr>
              <tr>
                <th>所属</th>
                <td>
                  {companyName}
                  {person?.employee_no && `（社員番号 ${person.employee_no}）`}
                </td>
              </tr>
            </tbody>
          </table>

          <div style={{ whiteSpace: "pre-wrap", marginBottom: 24 }}>{doc.body || ""}</div>

          <div style={{ textAlign: "right", marginTop: 24 }}>
            <div>発行日: {formatDateJa(doc.issued_date)}</div>
            <div style={{ marginTop: 8 }}>
              <div>{companyName}</div>
              {companyInfo?.address && <div>{companyInfo.address}</div>}
              {companyInfo?.tel && <div>TEL: {companyInfo.tel}</div>}
              <div style={{ marginTop: 4 }}>産業医　{doc.physician_name || ""}</div>
            </div>
          </div>

          {isOffice && !companyInfo?.address && (
            <p className="notice no-print" style={{ marginTop: 16 }}>
              企業の所在地が未登録です。企業ページの「企業情報」で所在地を登録すると、文書に自動で記載されます。
            </p>
          )}

          {isOffice && (
            <p className="notice no-print" style={{ marginTop: 16 }}>
              公開範囲: {VISIBILITY_LABELS[doc.visibility] ?? doc.visibility} /{" "}
              {DOC_TYPES[doc.doc_type] ?? doc.doc_type}
            </p>
          )}

          <div className="no-print" style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <PrintButton />
            {isOffice && (
              <Link className="btn secondary" href={`/document/${doc.id}/edit`}>
                編集する
              </Link>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
