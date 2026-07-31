import Link from "next/link";
import { notFound } from "next/navigation";
import Header from "@/components/Header";
import PrintButton from "@/components/PrintButton";
import DeleteMinutesButton from "@/components/DeleteMinutesButton";
import AttachmentsPanel from "@/components/AttachmentsPanel";
import { requireProfile, homePathFor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateJa } from "@/lib/fiscal";

export const dynamic = "force-dynamic";

export default async function MinutesDetailPage({ params }: { params: { id: string } }) {
  const { profile } = await requireProfile();
  const supabase = createClient();

  const { data: m } = await supabase
    .from("hm_minutes")
    .select(
      "id, company_id, meeting_date, title, attendees, agenda, published_to_employees, companies(name)"
    )
    .eq("id", params.id)
    .single();
  if (!m) notFound();

  // 個人情報を含みうる文書の閲覧を監査ログに記録
  await supabase.rpc("hm_log_access", {
    p_action: "view",
    p_target_table: "hm_minutes",
    p_target_id: m.id,
  });

  const { data: files } = await supabase
    .from("hm_minute_files")
    .select("id, file_name, storage_path")
    .eq("minutes_id", m.id)
    .order("created_at");

  const canEdit =
    profile.role === "office" ||
    (profile.role === "company" && profile.company_id === m.company_id);
  const backHref =
    profile.role === "office"
      ? `/office/${m.company_id}/minutes`
      : profile.role === "company"
        ? "/company/minutes"
        : homePathFor(profile.role);
  const companyName = (m as any).companies?.name ?? "";

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted no-print">
          <Link href={backHref}>← 一覧に戻る</Link>
        </p>

        <div className="card print-sheet">
          <div style={{ textAlign: "center", marginBottom: 18 }}>
            <h1 style={{ fontSize: 20, margin: 0 }}>{m.title}　議事録</h1>
            <div className="muted">{companyName}</div>
          </div>

          <table className="list" style={{ marginBottom: 16 }}>
            <tbody>
              <tr>
                <th style={{ width: 160 }}>開催日</th>
                <td>{formatDateJa(m.meeting_date)}</td>
              </tr>
              <tr>
                <th>出席者</th>
                <td style={{ whiteSpace: "pre-wrap" }}>{m.attendees || "—"}</td>
              </tr>
              <tr>
                <th>審議事項</th>
                <td style={{ whiteSpace: "pre-wrap" }}>{m.agenda || "—"}</td>
              </tr>
            </tbody>
          </table>

          <div className="no-print" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <PrintButton />
            {canEdit && (
              <Link className="btn secondary" href={`/minutes/${m.id}/edit`}>
                編集する
              </Link>
            )}
            {profile.role === "office" && <DeleteMinutesButton minutesId={m.id} />}
          </div>
        </div>

        <div className="card no-print">
          <h2>議事録ファイル・添付資料</h2>
          <AttachmentsPanel
            minutesId={m.id}
            companyId={m.company_id}
            initialFiles={files ?? []}
            canUpload={canEdit}
          />
        </div>
      </main>
    </>
  );
}
