"use client";

import { ChangeEvent, FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { makeStorageFileName } from "@/lib/storage";

export type MinutesInput = {
  id?: string;
  company_id: string;
  meeting_date: string;
  title: string;
  attendees: string;
  agenda: string;
  published_to_employees: boolean;
};

// 定例議題テンプレート
const AGENDA_TEMPLATE = `1. 前回議事録の確認
2. 労働災害・ヒヤリハットの報告
3. 長時間労働の状況
4. 健康診断・ストレスチェックの実施状況
5. 職場巡視の報告
6. 産業医からの助言
7. その他`;

export default function MinutesForm({
  initial,
  backHref,
}: {
  initial: MinutesInput;
  backHref: string;
}) {
  const router = useRouter();
  const [v, setV] = useState<MinutesInput>(initial);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof MinutesInput>(k: K, val: MinutesInput[K]) =>
    setV((p) => ({ ...p, [k]: val }));

  const onFilesChange = (e: ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    const tooBig = list.find((f) => f.size > 20 * 1024 * 1024);
    if (tooBig) {
      setError(`「${tooBig.name}」が20MBを超えています。20MB以下のファイルを選択してください。`);
      e.target.value = "";
      return;
    }
    setError(null);
    setFiles(list);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data: authUser } = await supabase.auth.getUser();

    const payload = {
      company_id: v.company_id,
      meeting_date: v.meeting_date,
      title: v.title.trim() || "安全衛生委員会",
      attendees: v.attendees.trim() || null,
      agenda: v.agenda.trim() || null,
      published_to_employees: v.published_to_employees,
    };

    let id = v.id;
    if (id) {
      const { error } = await supabase.from("hm_minutes").update(payload).eq("id", id);
      if (error) {
        setError(`保存に失敗しました: ${error.message}`);
        setBusy(false);
        return;
      }
      await supabase.rpc("hm_log_access", {
        p_action: "update",
        p_target_table: "hm_minutes",
        p_target_id: id,
      });
    } else {
      const { data, error } = await supabase
        .from("hm_minutes")
        .insert({ ...payload, created_by: authUser.user?.id })
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
        p_target_table: "hm_minutes",
        p_target_id: id,
      });
    }

    // 選択されたファイルをアップロード(本文なしのファイルのみ登録も可)
    for (const file of files) {
      const path = `${v.company_id}/${id}/${makeStorageFileName(file.name)}`;
      const { error: upErr } = await supabase.storage.from("hm-files").upload(path, file);
      if (upErr) {
        setError(
          `議事録は保存されましたが「${file.name}」のアップロードに失敗しました: ${upErr.message}`
        );
        setBusy(false);
        return;
      }
      const { data: fileRow, error: insErr } = await supabase
        .from("hm_minute_files")
        .insert({
          minutes_id: id,
          file_name: file.name,
          storage_path: path,
          uploaded_by: authUser.user?.id,
        })
        .select("id")
        .single();
      if (!insErr && fileRow) {
        await supabase.rpc("hm_log_access", {
          p_action: "upload",
          p_target_table: "hm_minute_files",
          p_target_id: fileRow.id,
          p_detail: { file_name: file.name },
        });
      }
    }

    router.replace(`/minutes/${id}`);
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit}>
      <div className="form-row">
        <label>開催日 *</label>
        <input
          type="date"
          value={v.meeting_date}
          onChange={(e) => set("meeting_date", e.target.value)}
          required
        />
      </div>
      <div className="form-row">
        <label>件名</label>
        <input
          type="text"
          value={v.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="安全衛生委員会"
        />
      </div>
      <div className="form-row">
        <label>出席者</label>
        <textarea
          value={v.attendees}
          onChange={(e) => set("attendees", e.target.value)}
          placeholder="委員長: ○○、衛生管理者: ○○、産業医: ○○ ほか"
          style={{ minHeight: 90 }}
        />
      </div>
      <div className="form-row">
        <label>
          審議事項{" "}
          {!v.agenda && (
            <button
              type="button"
              className="btn secondary"
              style={{ padding: "2px 10px", fontSize: 12, marginLeft: 8 }}
              onClick={() => set("agenda", AGENDA_TEMPLATE)}
            >
              定例議題テンプレートを挿入
            </button>
          )}
        </label>
        <textarea value={v.agenda} onChange={(e) => set("agenda", e.target.value)} />
        <p className="muted" style={{ margin: "4px 0 0" }}>
          自社で作成した議事録ファイルを登録する場合は、本文を空欄のままファイルだけ添付しても構いません。
        </p>
      </div>
      <div className="form-row">
        <label>議事録ファイルの添付（PDF・Word等、複数可）</label>
        <input
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
          onChange={onFilesChange}
        />
        {files.length > 0 && (
          <p className="muted" style={{ margin: "4px 0 0" }}>
            {files.map((f) => f.name).join("、")} を保存時にアップロードします。
          </p>
        )}
      </div>
      <div className="form-row checkbox-row">
        <input
          id="publish"
          type="checkbox"
          checked={v.published_to_employees}
          onChange={(e) => set("published_to_employees", e.target.checked)}
        />
        <label htmlFor="publish" style={{ margin: 0 }}>
          従業員に公開する
        </label>
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
