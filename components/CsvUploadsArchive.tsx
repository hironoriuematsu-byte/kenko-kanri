"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { CHECKUP_TYPES, roundLabel } from "@/lib/checkups";
import { downloadCsv } from "@/lib/checkupReport";

type Row = {
  id: string;
  company_id: string;
  company_name: string;
  kind: string;
  file_name: string;
  storage_path: string | null;
  file_size: number | null;
  row_count: number;
  fiscal_year: number | null;
  checkup_type: string | null;
  round: number;
  special_kind: string | null;
  has_content: boolean;
  created_at: string;
  finished_at: string | null;
};

// 実施者向け: 取込済みのCSV・PDFの原本(送られたファイル)の保管一覧。
// ダウンロードと削除ができる(0136 hm_csv_uploads_archived / hm_csv_upload_purge)
export default function CsvUploadsArchive({ companyId }: { companyId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("hm_csv_uploads_archived", { p_company_id: companyId });
    setRows(error ? [] : ((data ?? []) as Row[]));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const download = async (r: Row) => {
    setBusy(r.id);
    setError(null);
    const supabase = createClient();
    if (r.kind === "pdf" && r.storage_path) {
      const { data, error } = await supabase.storage
        .from("hm-files")
        .createSignedUrl(r.storage_path, 120, { download: r.file_name });
      if (error || !data?.signedUrl) setError(`ダウンロードできませんでした: ${error?.message ?? "unknown"}`);
      else {
        const a = document.createElement("a");
        a.href = data.signedUrl;
        a.download = r.file_name;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } else {
      // CSVの中身はデータベースから取り出してそのまま保存する
      const { data, error } = await supabase.rpc("hm_csv_upload_get", { p_id: r.id });
      const row = Array.isArray(data) ? data[0] : data;
      if (error || !row?.content) setError(`ダウンロードできませんでした: ${error?.message ?? "内容がありません"}`);
      else {
        const blob = new Blob(["﻿" + row.content], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = r.file_name;
        a.click();
        URL.revokeObjectURL(url);
      }
    }
    setBusy(null);
  };

  const purge = async (r: Row) => {
    const ok = window.confirm(
      `「${r.file_name}」の原本を削除します（取り込んだ健診データは残ります）。\nこの操作は元に戻せません。よろしいですか？`
    );
    if (!ok) return;
    setBusy(r.id);
    setError(null);
    const supabase = createClient();
    if (r.kind === "pdf" && r.storage_path) {
      const { error: rmErr } = await supabase.storage.from("hm-files").remove([r.storage_path]);
      if (rmErr) {
        setError(`PDFファイルを削除できませんでした: ${rmErr.message}`);
        setBusy(null);
        return;
      }
    }
    const { error } = await supabase.rpc("hm_csv_upload_purge", { p_id: r.id });
    if (error) setError(`削除できませんでした: ${error.message}`);
    else await load();
    setBusy(null);
  };

  if (!rows || rows.length === 0) return null;

  const fmt = (ts: string | null) => {
    if (!ts) return "—";
    const d = new Date(ts);
    return isNaN(d.getTime()) ? ts : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  };

  return (
    <div className="card" style={{ padding: "10px 16px" }}>
      <button
        className="btn secondary"
        style={{ padding: "4px 12px", fontSize: 13 }}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "▼" : "▶"} 送られたファイルの原本（{rows.length}件）
      </button>
      {open && (
        <>
          <p className="muted" style={{ fontSize: 12, margin: "8px 0" }}>
            事業者担当者から送られたCSV・PDFです。取込後も保管しています。不要になったら削除してください
            （取り込んだ健診データは残ります）。
          </p>
          {error && <p className="error-message">{error}</p>}
          <table className="list">
            <thead>
              <tr>
                <th>送信日</th>
                <th>ファイル</th>
                <th>対象</th>
                <th>取込日</th>
                <th style={{ width: 200 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{fmt(r.created_at)}</td>
                  <td>
                    <span className={`badge${r.kind === "pdf" ? " orange" : ""}`} style={{ marginRight: 6 }}>
                      {r.kind === "pdf" ? "PDF" : "CSV"}
                    </span>
                    {r.file_name}
                    {r.kind !== "pdf" && (
                      <span className="muted" style={{ fontSize: 12, marginLeft: 4 }}>（{r.row_count}名分）</span>
                    )}
                  </td>
                  <td>
                    {r.fiscal_year ? `${r.fiscal_year}年度` : "—"}
                    {roundLabel(r.round) ? `・${roundLabel(r.round)}` : ""}
                    {r.checkup_type ? ` / ${CHECKUP_TYPES[r.checkup_type] ?? r.checkup_type}` : ""}
                    {r.special_kind ? `（${r.special_kind}）` : ""}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmt(r.finished_at)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button
                      className="btn secondary"
                      style={{ padding: "4px 10px", fontSize: 12, marginRight: 6 }}
                      onClick={() => download(r)}
                      disabled={busy === r.id}
                    >
                      ダウンロード
                    </button>
                    <button
                      className="btn danger"
                      style={{ padding: "4px 10px", fontSize: 12 }}
                      onClick={() => purge(r)}
                      disabled={busy === r.id}
                    >
                      {busy === r.id ? "処理中…" : "削除"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
