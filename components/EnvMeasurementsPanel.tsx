"use client";

import { ChangeEvent, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { makeStorageFileName } from "@/lib/storage";
import { formatDateJa } from "@/lib/fiscal";

type Row = {
  id: string;
  measurement_date: string | null;
  title: string | null;
  note: string | null;
  file_name: string;
  storage_path: string;
  uploaded_by: string | null;
};

// 作業環境測定: 測定結果報告書のアップロード・一覧・ダウンロード
export default function EnvMeasurementsPanel({
  companyId,
  initialRows,
  role,
  currentUserId,
}: {
  companyId: string;
  initialRows: Row[];
  role: "office" | "company";
  currentUserId: string;
}) {
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [date, setDate] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setError("20MB以下のファイルをアップロードしてください。");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();

    const path = `${companyId}/env/${makeStorageFileName(file.name)}`;
    const { error: upErr } = await supabase.storage.from("hm-files").upload(path, file);
    if (upErr) {
      setError(`アップロードに失敗しました: ${upErr.message}`);
      setBusy(false);
      return;
    }

    const { data, error: insErr } = await supabase
      .from("hm_env_measurements")
      .insert({
        company_id: companyId,
        measurement_date: date || null,
        title: title.trim() || null,
        note: note.trim() || null,
        file_name: file.name,
        storage_path: path,
        uploaded_by: currentUserId,
      })
      .select("id, measurement_date, title, note, file_name, storage_path, uploaded_by")
      .single();
    if (insErr || !data) {
      setError(`登録に失敗しました: ${insErr?.message ?? "unknown"}`);
      setBusy(false);
      return;
    }
    await supabase.rpc("hm_log_access", {
      p_action: "upload",
      p_target_table: "hm_env_measurements",
      p_target_id: data.id,
      p_detail: { file_name: file.name },
    });
    setRows((prev) => [data, ...prev]);
    setDate("");
    setTitle("");
    setNote("");
    setBusy(false);
  };

  const onDownload = async (r: Row) => {
    setError(null);
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from("hm-files")
      .createSignedUrl(r.storage_path, 60, { download: r.file_name });
    if (error || !data) {
      setError("ダウンロードURLの発行に失敗しました。");
      return;
    }
    await supabase.rpc("hm_log_access", {
      p_action: "download",
      p_target_table: "hm_env_measurements",
      p_target_id: r.id,
      p_detail: { file_name: r.file_name },
    });
    window.open(data.signedUrl, "_blank");
  };

  const onDelete = async (r: Row) => {
    const reason = window.prompt(
      `「${r.file_name}」を削除します。理由を入力してください（ログに記録されます）:`
    );
    if (!reason) return;
    const supabase = createClient();
    const { error } = await supabase.from("hm_env_measurements").delete().eq("id", r.id);
    if (error) {
      setError(`削除に失敗しました: ${error.message}`);
      return;
    }
    await supabase.rpc("hm_log_access", {
      p_action: "delete",
      p_target_table: "hm_env_measurements",
      p_target_id: r.id,
      p_detail: { file_name: r.file_name, reason },
    });
    setRows((prev) => prev.filter((x) => x.id !== r.id));
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "flex-end",
          marginBottom: 16,
        }}
      >
        <div>
          <label className="muted" style={{ display: "block", fontSize: 12 }}>
            測定日
          </label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label className="muted" style={{ display: "block", fontSize: 12 }}>
            測定内容
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例: 騒音、粉じん、有機溶剤 など"
          />
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label className="muted" style={{ display: "block", fontSize: 12 }}>
            備考（任意）
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="測定機関名、第◯管理区分 など"
          />
        </div>
        <label className="btn orange" style={{ display: "inline-block" }}>
          {busy ? "アップロード中…" : "報告書ファイルを追加"}
          <input
            type="file"
            style={{ display: "none" }}
            onChange={onUpload}
            disabled={busy}
            accept=".pdf,.xlsx,.xls,.docx,.doc,.png,.jpg,.jpeg"
          />
        </label>
      </div>
      {error && <p className="error-message">{error}</p>}

      {rows.length > 0 ? (
        <table className="list">
          <thead>
            <tr>
              <th>測定日</th>
              <th>測定内容</th>
              <th>ファイル</th>
              <th>備考</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{formatDateJa(r.measurement_date)}</td>
                <td>{r.title || "—"}</td>
                <td>
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      onDownload(r);
                    }}
                  >
                    {r.file_name}
                  </a>
                </td>
                <td className="muted">{r.note ?? ""}</td>
                <td>
                  {(role === "office" || r.uploaded_by === currentUserId) && (
                    <button
                      className="btn danger"
                      style={{ padding: "3px 10px", fontSize: 12 }}
                      onClick={() => onDelete(r)}
                    >
                      削除
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">
          測定結果報告書はまだ登録されていません。測定日・内容を入力して「報告書ファイルを追加」からアップロードしてください。
        </p>
      )}
    </div>
  );
}
