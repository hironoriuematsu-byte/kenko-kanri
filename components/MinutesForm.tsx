"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { startNavigationProgress } from "@/lib/navigate";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { makeStorageFileName } from "@/lib/storage";
import VoiceInputButton, { appendText } from "@/components/VoiceInputButton";
import { clearDraft, ensureSession, isAuthError, saveDraft, takeDraft } from "@/lib/session";

// 入力が止まって数秒たつと自動で保存する(開催日が入っていれば新規の議事録も作成する)。
// 自動保存では「従業員に公開する」を変えない(新規は非公開で作成し、公開は「保存する」を押したときだけ)。
// 添付ファイルは「保存する」を押したときにアップロードする。
// ログインの期限切れ・自動ログアウトに備えて、入力内容はこのタブにも一時的に残す(再表示で復元)
const AUTOSAVE_DELAY_MS = 4000;

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
  const [status, setStatus] = useState<string | null>(null);
  // 自動保存で作成された議事録のID(新規作成の画面でも、以降は更新になる)
  const idRef = useRef<string | undefined>(initial.id);
  // 一時保存のキー。新規の議事録は自動保存で作成された時点でその議事録のキーに切り替える
  // (再ログイン後に編集画面を開けば続きが復元され、新規画面で二重に作られないようにする)
  const draftKeyRef = useRef(`minutes:${initial.id ?? `new:${initial.company_id}`}`);
  const contentOf = (x: MinutesInput) =>
    JSON.stringify([x.meeting_date, x.title, x.attendees, x.agenda]);
  // 最後にサーバーへ保存した内容(変わっていなければ自動保存しない)
  const lastSaved = useRef<string>(contentOf(initial));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  const [restored, setRestored] = useState(false);

  // 前回この画面で保存できなかった入力があれば復元する
  useEffect(() => {
    const raw = takeDraft(draftKeyRef.current);
    if (raw) {
      try {
        const d = JSON.parse(raw) as Partial<MinutesInput>;
        setV((p) => ({ ...p, ...d, id: p.id, company_id: p.company_id }));
        setStatus("前回保存されなかった入力内容を復元しました。内容を確認してください(そのまま自動保存されます)。");
      } catch {
        /* 壊れた下書きは捨てる */
      }
    }
    setRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 入力のたびにこのタブにも一時的に残す(保存に成功したら消す)
  useEffect(() => {
    if (!restored) return;
    if (contentOf(v) !== lastSaved.current) {
      saveDraft(draftKeyRef.current, JSON.stringify({ meeting_date: v.meeting_date, title: v.title, attendees: v.attendees, agenda: v.agenda }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, restored]);

  // 保存していない入力があるまま画面を閉じようとしたら確認する
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (contentOf(v) !== lastSaved.current || files.length > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, files]);

  const autoSave = useCallback(async () => {
    const snapshot = v;
    const content = contentOf(snapshot);
    if (content === lastSaved.current || saving.current) return;
    if (!snapshot.meeting_date) return; // 開催日が無いと保存できない(入力されてから保存する)
    if (!idRef.current && !snapshot.agenda.trim() && !snapshot.attendees.trim()) return; // 中身が無い新規は作らない
    saving.current = true;
    const supabase = createClient();
    const ok = await ensureSession(supabase);
    if (!ok) {
      setError("ログインの有効期限が切れています。入力内容はこの画面に残っています。ログインし直してからもう一度開くと復元されます。");
      saving.current = false;
      return;
    }
    const fields = {
      meeting_date: snapshot.meeting_date,
      title: snapshot.title.trim() || "安全衛生委員会",
      attendees: snapshot.attendees.trim() || null,
      agenda: snapshot.agenda.trim() || null,
    };
    let err: string | null = null;
    if (idRef.current) {
      const { error } = await supabase.from("hm_minutes").update(fields).eq("id", idRef.current);
      err = error?.message ?? null;
    } else {
      const { data: auth } = await supabase.auth.getSession();
      const { data, error } = await supabase
        .from("hm_minutes")
        .insert({ ...fields, company_id: snapshot.company_id, published_to_employees: false, created_by: auth.session?.user.id })
        .select("id")
        .single();
      err = error?.message ?? (data ? null : "unknown");
      if (data) {
        idRef.current = data.id;
        clearDraft(draftKeyRef.current);
        draftKeyRef.current = `minutes:${data.id}`;
        setV((p) => ({ ...p, id: data.id }));
        // 再読み込みしても続きから編集できるよう、URLを編集画面に置き換える(画面は移動しない)
        window.history.replaceState(null, "", `/minutes/${data.id}/edit`);
        void supabase.rpc("hm_log_access", { p_action: "create", p_target_table: "hm_minutes", p_target_id: data.id });
      }
    }
    saving.current = false;
    if (err) {
      setError(
        isAuthError(err)
          ? "ログインの有効期限が切れています。入力内容はこの画面に残っています。ログインし直してからもう一度開くと復元されます。"
          : `自動保存に失敗しました: ${err}`
      );
      return;
    }
    lastSaved.current = content;
    clearDraft(draftKeyRef.current);
    setError(null);
    const t = new Date();
    setStatus(`自動保存しました（${t.getHours()}:${String(t.getMinutes()).padStart(2, "0")}）`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);

  // 入力が止まってしばらくしたら自動保存する
  useEffect(() => {
    if (!restored) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void autoSave(), AUTOSAVE_DELAY_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [v, restored, autoSave]);

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
    if (timer.current) clearTimeout(timer.current);
    setBusy(true);
    setError(null);
    const supabase = createClient();
    // 長い入力中にログインの有効期限が切れていることがあるため、保存前に確認・更新する
    if (!(await ensureSession(supabase))) {
      setError("ログインの有効期限が切れています。入力内容はこの画面に残っています。ログインし直してからもう一度開くと復元されます。");
      setBusy(false);
      return;
    }
    const { data: authUser } = await supabase.auth.getUser();

    const payload = {
      company_id: v.company_id,
      meeting_date: v.meeting_date,
      title: v.title.trim() || "安全衛生委員会",
      attendees: v.attendees.trim() || null,
      agenda: v.agenda.trim() || null,
      published_to_employees: v.published_to_employees,
    };

    let id = idRef.current;
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

    lastSaved.current = contentOf(v);
    clearDraft(draftKeyRef.current);
    setFiles([]);
    startNavigationProgress();

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
          <VoiceInputButton onAppend={(t) => setV((p) => ({ ...p, agenda: appendText(p.agenda, t) }))} />
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
      {status && !error && (
        <p className="muted" style={{ margin: "8px 0 0" }}>
          {status}
        </p>
      )}
      <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
        入力内容は、開催日を入れると数秒ごとに自動で保存されます(従業員への公開と添付ファイルの登録は「保存する」を押したときに行います)。
      </p>

      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "保存中…" : "保存する"}
        </button>
        <button type="button" className="btn secondary" onClick={() => { startNavigationProgress(); router.push(backHref); }}>
          キャンセル
        </button>
      </div>
    </form>
  );
}
