"use client";

import { ChangeEvent, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { makeStorageFileName } from "@/lib/storage";

type FileRow = { id: string; file_name: string; storage_path: string };

export default function AttachmentsPanel({
  minutesId,
  companyId,
  initialFiles,
  canUpload,
}: {
  minutesId: string;
  companyId: string;
  initialFiles: FileRow[];
  canUpload: boolean;
}) {
  const [files, setFiles] = useState<FileRow[]>(initialFiles);
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

    const path = `${companyId}/${minutesId}/${makeStorageFileName(file.name)}`;

    const { error: upErr } = await supabase.storage.from("hm-files").upload(path, file);
    if (upErr) {
      setError(`アップロードに失敗しました: ${upErr.message}`);
      setBusy(false);
      return;
    }

    const { data: user } = await supabase.auth.getUser();
    const { data, error: insErr } = await supabase
      .from("hm_minute_files")
      .insert({
        minutes_id: minutesId,
        file_name: file.name,
        storage_path: path,
        uploaded_by: user.user?.id,
      })
      .select("id, file_name, storage_path")
      .single();
    if (insErr || !data) {
      setError(`登録に失敗しました: ${insErr?.message ?? "unknown"}`);
      setBusy(false);
      return;
    }
    await supabase.rpc("hm_log_access", {
      p_action: "upload",
      p_target_table: "hm_minute_files",
      p_target_id: data.id,
      p_detail: { file_name: file.name },
    });
    setFiles((prev) => [...prev, data]);
    setBusy(false);
  };

  const onDownload = async (f: FileRow) => {
    setError(null);
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from("hm-files")
      .createSignedUrl(f.storage_path, 60, { download: f.file_name });
    if (error || !data) {
      setError("ダウンロードURLの発行に失敗しました。");
      return;
    }
    await supabase.rpc("hm_log_access", {
      p_action: "download",
      p_target_table: "hm_minute_files",
      p_target_id: f.id,
      p_detail: { file_name: f.file_name },
    });
    window.open(data.signedUrl, "_blank");
  };

  return (
    <div>
      {files.length > 0 ? (
        <ul style={{ paddingLeft: 20, margin: "0 0 12px" }}>
          {files.map((f) => (
            <li key={f.id}>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  onDownload(f);
                }}
              >
                {f.file_name}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">添付ファイルはありません。</p>
      )}

      {canUpload && (
        <label className="btn secondary" style={{ display: "inline-block" }}>
          {busy ? "アップロード中…" : "ファイルを追加"}
          <input
            type="file"
            style={{ display: "none" }}
            onChange={onUpload}
            disabled={busy}
            accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx,.csv"
          />
        </label>
      )}
      {error && <p className="error-message">{error}</p>}
    </div>
  );
}
