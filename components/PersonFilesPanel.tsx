"use client";

import { ChangeEvent, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { makeStorageFileName } from "@/lib/storage";
import { FILE_CATEGORIES, VISIBILITY_LABELS } from "@/lib/karte";
import { formatDateJa } from "@/lib/fiscal";

type FileRow = {
  id: string;
  category: string;
  file_name: string;
  storage_path: string;
  note: string | null;
  visibility: string;
  uploaded_by: string | null;
  created_at: string;
};

// カルテ添付書類(診断書等)。officeは公開範囲を選択可、companyは常に共有扱い
export default function PersonFilesPanel({
  personId,
  companyId,
  initialFiles,
  role,
  currentUserId,
}: {
  personId: string;
  companyId: string;
  initialFiles: FileRow[];
  role: "office" | "company";
  currentUserId: string;
}) {
  const [files, setFiles] = useState<FileRow[]>(initialFiles);
  const [category, setCategory] = useState("medical_certificate");
  const [visibility, setVisibility] = useState("shared");
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

    const vis = role === "office" ? visibility : "shared";
    // office限定ファイルは 'office/' 配下に置き、企業のStorageポリシーから分離する
    const prefix = vis === "office_only" ? "office" : companyId;
    const path = `${prefix}/persons/${personId}/${makeStorageFileName(file.name)}`;

    const { error: upErr } = await supabase.storage.from("hm-files").upload(path, file);
    if (upErr) {
      setError(`アップロードに失敗しました: ${upErr.message}`);
      setBusy(false);
      return;
    }

    const { data, error: insErr } = await supabase
      .from("hm_person_files")
      .insert({
        person_id: personId,
        company_id: companyId,
        category,
        file_name: file.name,
        storage_path: path,
        note: note.trim() || null,
        visibility: vis,
        uploaded_by: currentUserId,
      })
      .select("id, category, file_name, storage_path, note, visibility, uploaded_by, created_at")
      .single();
    if (insErr || !data) {
      setError(`登録に失敗しました: ${insErr?.message ?? "unknown"}`);
      setBusy(false);
      return;
    }
    await supabase.rpc("hm_log_access", {
      p_action: "upload",
      p_target_table: "hm_person_files",
      p_target_id: data.id,
      p_detail: { file_name: file.name, visibility: vis },
    });
    setFiles((prev) => [data, ...prev]);
    setNote("");
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
      p_target_table: "hm_person_files",
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
    const { error } = await supabase.from("hm_person_files").delete().eq("id", f.id);
    if (error) {
      setError(`削除に失敗しました: ${error.message}`);
      return;
    }
    await supabase.rpc("hm_log_access", {
      p_action: "delete",
      p_target_table: "hm_person_files",
      p_target_id: f.id,
      p_detail: { file_name: f.file_name, reason },
    });
    setFiles((prev) => prev.filter((x) => x.id !== f.id));
  };

  return (
    <div>
      {files.length > 0 ? (
        <table className="list" style={{ marginBottom: 14 }}>
          <thead>
            <tr>
              <th>区分</th>
              <th>ファイル</th>
              <th>備考</th>
              <th>登録日</th>
              {role === "office" && <th>公開範囲</th>}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id}>
                <td>{FILE_CATEGORIES[f.category] ?? f.category}</td>
                <td>
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      onDownload(f);
                    }}
                  >
                    {f.file_name}
                  </a>
                </td>
                <td className="muted">{f.note ?? ""}</td>
                <td>{formatDateJa(f.created_at.slice(0, 10))}</td>
                {role === "office" && (
                  <td>
                    {f.visibility === "office_only" ? (
                      <span className="badge orange">{VISIBILITY_LABELS[f.visibility]}</span>
                    ) : (
                      <span className="badge">{VISIBILITY_LABELS[f.visibility]}</span>
                    )}
                  </td>
                )}
                <td>
                  {(role === "office" || f.uploaded_by === currentUserId) && (
                    <button
                      className="btn danger"
                      style={{ padding: "3px 10px", fontSize: 12 }}
                      onClick={() => onDelete(f)}
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
        <p className="muted">書類はまだ登録されていません。</p>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <label className="muted" style={{ display: "block", fontSize: 12 }}>
            区分
          </label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {Object.entries(FILE_CATEGORIES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        {role === "office" && (
          <div>
            <label className="muted" style={{ display: "block", fontSize: 12 }}>
              公開範囲
            </label>
            <select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
              <option value="shared">企業と共有</option>
              <option value="office_only">産業医事務所のみ</option>
            </select>
          </div>
        )}
        <div style={{ flex: 1, minWidth: 160 }}>
          <label className="muted" style={{ display: "block", fontSize: 12 }}>
            備考（任意）
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例: ○○病院 2026/7 発行"
          />
        </div>
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
      </div>
      {error && <p className="error-message">{error}</p>}
    </div>
  );
}
