"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { CHECKUP_TYPES, roundLabel } from "@/lib/checkups";

type Upload = {
  id: string;
  company_id: string;
  company_name: string;
  kind?: string; // 'csv' | 'pdf'(0136 以前は undefined = csv)
  file_name: string;
  storage_path?: string | null;
  file_size?: number | null;
  row_count: number;
  fiscal_year: number | null;
  checkup_type: string | null;
  round: number;
  special_kind: string | null;
  note: string | null;
  uploaded_by_name: string | null;
  created_at: string;
};

// 産業医事務所ダッシュボード: 事業者担当者から送られた取込待ちのCSV / PDF(0135・0136)
//   CSV: 「取り込む」で取込画面を開く
//   PDF: ダウンロードしてCSVに変換し、その企業の取込画面から取り込む。終わったら「処理済み」
export default function CsvUploadsPending() {
  const [uploads, setUploads] = useState<Upload[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("hm_csv_uploads_pending");
    if (error) {
      setUploads([]); // 0135 未適用のときは何も出さない
      return;
    }
    setUploads((data ?? []) as Upload[]);
  };

  useEffect(() => {
    load();
  }, []);

  // PDFを署名付きURLでダウンロードする(非公開バケット。URLは2分間だけ有効)
  const download = async (u: Upload) => {
    if (!u.storage_path) return;
    setBusy(u.id);
    setError(null);
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from("hm-files")
      .createSignedUrl(u.storage_path, 120, { download: u.file_name });
    if (error || !data?.signedUrl) {
      setError(`ダウンロードできませんでした: ${error?.message ?? "unknown"}`);
    } else {
      const a = document.createElement("a");
      a.href = data.signedUrl;
      a.download = u.file_name;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setBusy(null);
  };

  // 処理済み / 破棄。原本は「破棄」のときだけ消す(処理済みでは保管し、後から削除できる)
  const finish = async (u: Upload, status: "imported" | "discarded") => {
    const label = status === "imported" ? "処理済みにします" : "取り込まずに破棄します";
    const ok = window.confirm(
      `${u.company_name} から送られた「${u.file_name}」を${label}。\n` +
        (status === "discarded"
          ? "送られたファイルは削除されます。\n"
          : "送られたファイルは原本として保管され、健診一覧の「送られたファイルの原本」から確認・削除できます。\n") +
        "よろしいですか？"
    );
    if (!ok) return;
    setBusy(u.id);
    setError(null);
    const supabase = createClient();
    if (status === "discarded" && u.kind === "pdf" && u.storage_path) {
      const { error: rmErr } = await supabase.storage.from("hm-files").remove([u.storage_path]);
      if (rmErr) {
        setError(`PDFファイルを削除できませんでした: ${rmErr.message}`);
        setBusy(null);
        return;
      }
    }
    const { error } = await supabase.rpc("hm_csv_upload_finish", {
      p_id: u.id,
      p_status: status,
      p_batch: null,
    });
    if (error) setError(`更新できませんでした: ${error.message}`);
    else await load();
    setBusy(null);
  };

  if (!uploads || uploads.length === 0) return null;

  const fmt = (ts: string) => {
    const d = new Date(ts);
    return isNaN(d.getTime())
      ? ts
      : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const sizeLabel = (bytes?: number | null) =>
    bytes == null
      ? ""
      : bytes >= 1024 * 1024
        ? `${(bytes / 1024 / 1024).toFixed(1)}MB`
        : `${Math.ceil(bytes / 1024)}KB`;
  const hasPdf = uploads.some((u) => u.kind === "pdf");

  return (
    <div className="card" style={{ borderColor: "var(--orange)" }}>
      <h2>取込待ちのファイルがあります（{uploads.length}件）</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        事業者担当者から送られた健診結果です。CSVは「取り込む」を押すと取込画面が開き、列の割り当てを指定して取り込めます。
        {hasPdf && (
          <>
            <br />
            PDFは「ダウンロード」して内容をCSVに変換し、その企業の取込画面（CSV一括取込）から取り込んでください。
            終わったら「処理済み」を押してください（PDFは原本として保管され、健診一覧から削除できます）。
          </>
        )}
      </p>
      {error && <p className="error-message">{error}</p>}
      <table className="list">
        <thead>
          <tr>
            <th>送信日時</th>
            <th>企業</th>
            <th>ファイル</th>
            <th>対象（担当者の指定）</th>
            <th>連絡事項</th>
            <th>送った方</th>
            <th style={{ width: 260 }}></th>
          </tr>
        </thead>
        <tbody>
          {uploads.map((u) => {
            const isPdf = u.kind === "pdf";
            return (
              <tr key={u.id}>
                <td style={{ whiteSpace: "nowrap" }}>{fmt(u.created_at)}</td>
                <td>{u.company_name}</td>
                <td>
                  <span className={`badge${isPdf ? " orange" : ""}`} style={{ marginRight: 6 }}>
                    {isPdf ? "PDF" : "CSV"}
                  </span>
                  {u.file_name}
                  <span className="muted" style={{ fontSize: 12, marginLeft: 4 }}>
                    {isPdf ? `（${sizeLabel(u.file_size)}）` : `（${u.row_count}名分）`}
                  </span>
                </td>
                <td>
                  {u.fiscal_year ? `${u.fiscal_year}年度` : "—"}
                  {roundLabel(u.round) ? `・${roundLabel(u.round)}` : ""}
                  {u.checkup_type ? ` / ${CHECKUP_TYPES[u.checkup_type] ?? u.checkup_type}` : ""}
                  {u.special_kind ? `（${u.special_kind}）` : ""}
                </td>
                <td style={{ fontSize: 13 }}>{u.note ?? <span className="muted">—</span>}</td>
                <td>{u.uploaded_by_name ?? "—"}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {isPdf ? (
                    <>
                      <button
                        className="btn orange"
                        style={{ padding: "4px 10px", fontSize: 12, marginRight: 6 }}
                        onClick={() => download(u)}
                        disabled={busy === u.id}
                      >
                        ダウンロード
                      </button>
                      <Link
                        className="btn secondary"
                        style={{ padding: "4px 10px", fontSize: 12, marginRight: 6 }}
                        href={`/office/${u.company_id}/checkups/import`}
                      >
                        取込画面
                      </Link>
                      <button
                        className="btn"
                        style={{ padding: "4px 10px", fontSize: 12, marginRight: 6 }}
                        onClick={() => finish(u, "imported")}
                        disabled={busy === u.id}
                      >
                        処理済み
                      </button>
                    </>
                  ) : (
                    <Link
                      className="btn orange"
                      style={{ padding: "4px 10px", fontSize: 12, marginRight: 6 }}
                      href={`/office/${u.company_id}/checkups/import?upload=${u.id}`}
                    >
                      取り込む
                    </Link>
                  )}
                  <button
                    className="btn secondary"
                    style={{ padding: "4px 10px", fontSize: 12 }}
                    onClick={() => finish(u, "discarded")}
                    disabled={busy === u.id}
                  >
                    {busy === u.id ? "処理中…" : "破棄"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
