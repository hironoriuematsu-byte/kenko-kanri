"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { CHECKUP_TYPES, roundLabel } from "@/lib/checkups";

type Upload = {
  id: string;
  company_id: string;
  company_name: string;
  file_name: string;
  row_count: number;
  fiscal_year: number | null;
  checkup_type: string | null;
  round: number;
  special_kind: string | null;
  note: string | null;
  uploaded_by_name: string | null;
  created_at: string;
};

// 産業医事務所ダッシュボード: 事業者担当者から送られた取込待ちのCSV(0135 hm_csv_uploads)
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

  const discard = async (u: Upload) => {
    const ok = window.confirm(
      `${u.company_name} から送られた「${u.file_name}」を取り込まずに破棄します。\nよろしいですか？`
    );
    if (!ok) return;
    setBusy(u.id);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("hm_csv_upload_finish", {
      p_id: u.id,
      p_status: "discarded",
      p_batch: null,
    });
    if (error) setError(`破棄できませんでした: ${error.message}`);
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

  return (
    <div className="card" style={{ borderColor: "var(--orange)" }}>
      <h2>取込待ちのCSVがあります（{uploads.length}件）</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        事業者担当者から送られた健診結果のCSVです。「取り込む」を押すと取込画面が開き、
        列の割り当てを指定して取り込めます。
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
            <th style={{ width: 190 }}></th>
          </tr>
        </thead>
        <tbody>
          {uploads.map((u) => (
            <tr key={u.id}>
              <td style={{ whiteSpace: "nowrap" }}>{fmt(u.created_at)}</td>
              <td>{u.company_name}</td>
              <td>
                {u.file_name}
                <span className="muted" style={{ fontSize: 12, marginLeft: 4 }}>（{u.row_count}名分）</span>
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
                <Link
                  className="btn orange"
                  style={{ padding: "4px 10px", fontSize: 12, marginRight: 6 }}
                  href={`/office/${u.company_id}/checkups/import?upload=${u.id}`}
                >
                  取り込む
                </Link>
                <button
                  className="btn secondary"
                  style={{ padding: "4px 10px", fontSize: 12 }}
                  onClick={() => discard(u)}
                  disabled={busy === u.id}
                >
                  {busy === u.id ? "処理中…" : "破棄"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
