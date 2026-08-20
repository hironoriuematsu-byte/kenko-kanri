"use client";

import { ChangeEvent, FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { makeStorageFileName } from "@/lib/storage";

export type PatrolInput = {
  id?: string;
  company_id: string;
  patrol_date: string;
  findings: string; // 指摘事項等(巡視場所・所見・指導・改善状況をまとめて記載)
  physician_name: string;
};

// 産業医巡視記録の作成・編集(officeのみ)
export default function PatrolForm({
  initial,
  backHref,
}: {
  initial: PatrolInput;
  backHref: string;
}) {
  const router = useRouter();
  const [v, setV] = useState<PatrolInput>(initial);
  const [photos, setPhotos] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onPhotosChange = (e: ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    const tooBig = list.find((f) => f.size > 20 * 1024 * 1024);
    if (tooBig) {
      setError(`「${tooBig.name}」が20MBを超えています。20MB以下のファイルを選択してください。`);
      e.target.value = "";
      return;
    }
    setError(null);
    setPhotos(list);
  };

  const set = <K extends keyof PatrolInput>(k: K, val: PatrolInput[K]) =>
    setV((p) => ({ ...p, [k]: val }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();

    const payload = {
      company_id: v.company_id,
      patrol_date: v.patrol_date,
      areas: null,
      findings: v.findings.trim() || null,
      advice: null,
      note: null,
      physician_name: v.physician_name.trim() || null,
    };

    let id = v.id;
    if (id) {
      const { error } = await supabase.from("hm_patrols").update(payload).eq("id", id);
      if (error) {
        setError(`保存に失敗しました: ${error.message}`);
        setBusy(false);
        return;
      }
      await supabase.rpc("hm_log_access", {
        p_action: "update",
        p_target_table: "hm_patrols",
        p_target_id: id,
      });
    } else {
      const { data: user } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("hm_patrols")
        .insert({ ...payload, created_by: user.user?.id })
        .select("id")
        .single();
      if (error || !data) {
        setError(`作成に失敗しました: ${error?.message ?? "unknown"}`);
        setBusy(false);
        return;
      }
      id = data.id;
      await supabase.rpc("hm_log_access", {
        p_action: "create",
        p_target_table: "hm_patrols",
        p_target_id: id,
      });
    }

    // 選択された現場写真をアップロード
    const { data: authUser } = await supabase.auth.getUser();
    for (const file of photos) {
      const path = `${v.company_id}/patrols/${id}/${makeStorageFileName(file.name)}`;
      const { error: upErr } = await supabase.storage.from("hm-files").upload(path, file);
      if (upErr) {
        setError(
          `巡視記録は保存されましたが「${file.name}」のアップロードに失敗しました: ${upErr.message}`
        );
        setBusy(false);
        return;
      }
      const { data: fileRow, error: insErr } = await supabase
        .from("hm_patrol_files")
        .insert({
          patrol_id: id,
          file_name: file.name,
          storage_path: path,
          uploaded_by: authUser.user?.id,
        })
        .select("id")
        .single();
      if (!insErr && fileRow) {
        await supabase.rpc("hm_log_access", {
          p_action: "upload",
          p_target_table: "hm_patrol_files",
          p_target_id: fileRow.id,
          p_detail: { file_name: file.name },
        });
      }
    }

    router.replace(`/patrols/${id}`);
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit}>
      <div className="form-row">
        <label>巡視日 *</label>
        <input
          type="date"
          value={v.patrol_date}
          onChange={(e) => set("patrol_date", e.target.value)}
          required
        />
      </div>
      <div className="form-row">
        <label>指摘事項等</label>
        <textarea
          value={v.findings}
          onChange={(e) => set("findings", e.target.value)}
          placeholder={
            "巡視場所、指摘事項・所見、指導・助言、改善状況などをまとめて記載してください。\n例:\n本社2F事務室・倉庫・休憩室を巡視。通路に荷物が仮置きされ動線を塞いでいるため整理を指導。休憩室の換気不良あり、換気扇の点検を依頼。前回指摘の配線カバーは改善済み。"
          }
          style={{ minHeight: 180 }}
        />
      </div>
      <div className="form-row">
        <label>現場写真・添付ファイル（複数選択できます）</label>
        <input
          type="file"
          multiple
          accept="image/*,.pdf,.docx,.xlsx"
          onChange={onPhotosChange}
        />
        {photos.length > 0 && (
          <p className="muted" style={{ margin: "4px 0 0" }}>
            {photos.map((f) => f.name).join("、")} を保存時にアップロードします。
          </p>
        )}
        <p className="muted" style={{ margin: "4px 0 0" }}>
          写真は保存後の巡視記録画面でサムネイル表示され、追加・削除もできます。
        </p>
      </div>
      <div className="form-row">
        <label>産業医名（別の先生が担当した場合は書き換えてください。敬称は付けません）</label>
        <input
          type="text"
          value={v.physician_name}
          onChange={(e) => set("physician_name", e.target.value)}
          placeholder="上松弘典"
          style={{ maxWidth: 260 }}
        />
      </div>

      {error && <p className="error-message">{error}</p>}
      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "保存中…" : "保存する"}
        </button>
        <button type="button" className="btn secondary" onClick={() => router.push(backHref)}>
          キャンセル
        </button>
      </div>
    </form>
  );
}
