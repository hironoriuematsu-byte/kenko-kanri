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
  const supabase = createClient();
  // ログイン確認・文書の取得・閲覧ログは同時に行う(待ち時間の短縮)
  const [{ profile }, { data: doc }] = await Promise.all([
    requireProfile(),
    supabase
      .from("hm_person_documents")
      .select(
        "id, person_id, company_id, doc_type, title, addressee, body, issued_date, physician_name, visibility, hm_persons(full_name, employee_no, birth_date), companies(name)"
      )
      .eq("id", params.id)
      .single(),
    supabase.rpc("hm_log_access", {
      p_action: "view",
      p_target_table: "hm_person_documents",
      p_target_id: params.id,
    }),
  ]);
  if (profile.role !== "office" && profile.role !== "company") {
    redirect(homePathFor(profile.role));
  }
  if (!doc) notFound();

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
          {/* 発行日は文書の右上に置く */}
          <div style={{ textAlign: "right", marginBottom: 6 }}>{formatDateJa(doc.issued_date)}</div>
          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <h1 style={{ fontSize: 20, margin: 0 }}>{doc.title}</h1>
          </div>

          {doc.addressee && (
            <p style={{ fontSize: "1.12em", margin: "0 0 16px" }}>
              {doc.addressee}　先生御侍史
            </p>
          )}

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
            <div style={{ marginTop: 8 }}>
              <div>{companyName}</div>
              {companyInfo?.address && <div>{companyInfo.address}</div>}
              {companyInfo?.tel && <div>TEL: {companyInfo.tel}</div>}
              <div style={{ marginTop: 4 }}>産業医　{doc.physician_name || ""}</div>
            </div>
          </div>

          {/* 診療情報提供依頼書: 本人が産業医と主治医の間の情報共有に同意する欄(印刷して署名してもらう) */}
          {doc.doc_type === "referral_request" && (
            <div style={{ marginTop: 32, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
              <h2 style={{ fontSize: 15, margin: "0 0 8px" }}>本人同意欄</h2>
              <p style={{ margin: "0 0 14px", lineHeight: 1.9 }}>
                私は、上記の目的のため、主治医
                {doc.addressee ? `（${/先生$/.test(doc.addressee.trim()) ? doc.addressee.trim() : `${doc.addressee.trim()}　先生`}）` : ""}
                と産業医（{companyName}の産業医　{doc.physician_name || ""}）との間で、私の診療情報・健康診断結果などの健康情報を相互に提供し、共有することに同意します。
              </p>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div>
                  同意日：　　　　年　　　月　　　日
                </div>
                <div style={{ flex: 1, minWidth: 260 }}>
                  本人署名：
                  <span style={{ display: "inline-block", width: 220, borderBottom: "1px solid var(--ink)", marginLeft: 8, height: 22, verticalAlign: "bottom" }} />
                </div>
              </div>
            </div>
          )}

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
