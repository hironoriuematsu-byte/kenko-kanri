"use client";

import { ChangeEvent, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { makeStorageFileName } from "@/lib/storage";

type FileRow = { id: string; file_name: string; storage_path: string };

// 産業医巡視記録の添付(写真・資料)。アップロードはoffice、閲覧はcompanyも可
export default function PatrolFilesPanel({
  patrolId,
  companyId,
  initialFiles,
  canUpload,
}: {
  patrolId: string;
  companyId: string;
  initialFiles: FileRow[];
  canUpload: boolean;
}) {
  const [files, setFiles] = useState<FileRow[]>(initialFiles);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (list.length === 0) return;
    const tooBig = list.find((f) => f.size > 20 * 1024 * 1024);
    if (tooBig) {
      setError(`「${tooBig.name}」が20MBを超えています。`);
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data: authUser } = await supabase.auth.getUser();

    for (const file of list) {
      const path = `${companyId}/patrols/${patrolId}/${makeStorageFileName(file.name)}`;
      const { error: upErr } = await supabase.storage.from("hm-files").upload(path, file);
      if (upErr) {
        setError(`「${file.name}」のアップロードに失敗しました: ${upErr.message}`);
        setBusy(false);
        return;
      }
      const { data, error: insErr } = await supabase
        .from("hm_patrol_files")
        .insert({
          patrol_id: patrolId,
          file_name: file.name,
          storage_path: path,
          uploaded_by: authUser.user?.id,
        })
        .select("id, file_name, storage_path")
        .single();
      if (insErr || !data) {
        setError(`「${file.name}」の登録に失敗しました: ${insErr?.message ?? "unknown"}`);
        setBusy(false);
        return;
      }
      await supabase.rpc("hm_log_access", {
        p_action: "upload",
        p_target_table: "hm_patrol_files",
        p_target_id: data.id,
        p_detail: { file_name: file.name },
      });
      setFiles((prev) => [...prev, data]);
    }
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
      p_target_table: "hm_patrol_files",
      p_target_id: f.id,
      p_detail: { file_name: f.file_name },
    });
    window.open(data.signedUrl, "_blank");
  };

  const onDelete = async (f: FileRow) => {
    const reason = window.prompt(
      `「${f.file_name}」を削除します。理由を入力してください（ログに記録されます）:`
    );
    if (!reason) return;
    const supabase = createClient();
    const { error } = await supabase.from("hm_patrol_files").delete().eq("id", f.id);
    if (error) {
      setError(`削除に失敗しました: ${error.message}`);
      return;
    }
    await supabase.rpc("hm_log_access", {
      p_action: "delete",
      p_target_table: "hm_patrol_files",
      p_target_id: f.id,
      p_detail: { file_name: f.file_name, reason },
    });
    setFiles((prev) => prev.filter((x) => x.id !== f.id));
  };

  return (
    <div>
      {files.length > 0 ? (
        <ul style={{ paddingLeft: 20, margin: "0 0 12px" }}>
          {files.map((f) => (
            <li key={f.id} style={{ marginBottom: 4 }}>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  onDownload(f);
                }}
              >
                {f.file_name}
              </a>
              {canUpload && (
                <button
                  className="btn danger"
                  style={{ padding: "1px 8px", fontSize: 11, marginLeft: 8 }}
                  onClick={() => onDelete(f)}
                >
                  削除
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">写真・添付ファイルはありません。</p>
      )}

      {canUpload && (
        <label className="btn secondary" style={{ display: "inline-block" }}>
          {busy ? "アップロード中…" : "写真・ファイルを追加（複数可）"}
          <input
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={onUpload}
            disabled={busy}
            accept="image/*,.pdf,.docx,.xlsx"
          />
        </label>
      )}
      {error && <p className="error-message">{error}</p>}
    </div>
  );
}
