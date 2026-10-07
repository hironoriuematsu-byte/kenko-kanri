"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { clearDraft, ensureSession, isAuthError, saveDraft, takeDraft } from "@/lib/session";
import VoiceInputButton, { appendText } from "@/components/VoiceInputButton";

// 面談の事前情報(office/company共有・従業員本人には非表示)。RPC経由で読み書き。
// 入力が止まって数秒たつと自動で保存する(アクセスログは同じ人・同じ面談で1時間に1行: 0138)
const AUTOSAVE_DELAY_MS = 4000;

export default function PreInfoPanel({ interviewId }: { interviewId: string }) {
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needLogin, setNeedLogin] = useState(false);
  const draftKey = `pre-info:${interviewId}`;
  const lastSaved = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .rpc("hm_get_interview_pre_info", { p_id: interviewId })
      .then(({ data, error }) => {
        if (error) {
          setError(
            /function|schema cache/i.test(error.message)
              ? "事前情報機能のSQL(0108)が未実行です。SQL Editorで実行してください。"
              : `事前情報の取得に失敗しました: ${error.message}`
          );
        } else {
          setText((data as string) ?? "");
          lastSaved.current = (data as string) ?? "";
        }
        // 再ログイン前に残しておいた未保存の入力があれば復元する
        const draft = takeDraft(draftKey);
        if (draft !== null && draft !== ((data as string) ?? "")) {
          setText(draft);
          setNotice("未保存の入力内容を復元しました。内容を確認してください(そのまま自動保存されます)。");
        }
        setLoaded(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewId]);

  // 期限切れのとき: 入力内容を残してログイン画面へ。ログイン後はこの画面に戻る
  const goLogin = () => {
    saveDraft(draftKey, text);
    const next = encodeURIComponent(window.location.pathname);
    window.location.href = `/login?next=${next}`;
  };

  const save = useCallback(
    async (auto: boolean) => {
      if (auto && lastSaved.current === text) return; // 変わっていない
      setBusy(true);
      setError(null);
      setNotice(null);
      const supabase = createClient();

      // 長時間の入力でログインの有効期限が切れていることがあるため、保存前に確認・更新する
      const ok = await ensureSession(supabase);
      if (!ok) {
        saveDraft(draftKey, text);
        setNeedLogin(true);
        setError("ログインの有効期限が切れています。入力内容はこの画面に保持されますので、下のボタンからログインし直してください。");
        setBusy(false);
        return;
      }

      const { error } = await supabase.rpc("hm_save_interview_pre_info", {
        p_id: interviewId,
        p_text: text,
      });
      if (error) {
        if (isAuthError(error.message)) {
          saveDraft(draftKey, text);
          setNeedLogin(true);
          setError("ログインの有効期限が切れています。入力内容はこの画面に保持されますので、下のボタンからログインし直してください。");
        } else {
          setError(`保存に失敗しました: ${error.message}`);
        }
      } else {
        lastSaved.current = text;
        clearDraft(draftKey);
        setNeedLogin(false);
        const t = new Date();
        const hm = `${t.getHours()}:${String(t.getMinutes()).padStart(2, "0")}`;
        setStatus(auto ? `自動保存しました（${hm}）` : `保存しました（${hm}）`);
      }
      setBusy(false);
    },
    [text, interviewId, draftKey]
  );

  // 入力が止まってしばらくしたら自動保存する
  useEffect(() => {
    if (!loaded) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(true), AUTOSAVE_DELAY_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [text, loaded, save]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (timer.current) clearTimeout(timer.current);
    await save(false);
  };

  if (!loaded) return <p className="muted">事前情報を読み込み中…</p>;

  return (
    <form onSubmit={onSubmit}>
      <div className="form-row">
        <div style={{ marginBottom: 4 }}>
          <VoiceInputButton
            onAppend={(t) => {
              setText((prev) => appendText(prev, t));
              setStatus(null);
            }}
          />
        </div>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setStatus(null);
          }}
          onBlur={() => save(true)}
          placeholder={
            "面談前に共有しておきたい情報を記入してください。入力が止まると自動で保存されます。\n例: 直近3か月の時間外労働時間、勤怠状況(遅刻・欠勤等)、相談に至った経緯、職場での様子 など"
          }
          style={{ minHeight: 120 }}
        />
      </div>
      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error-message">{error}</p>}
      {status && <p style={{ color: "var(--teal-dark)", fontSize: 13 }}>{status}</p>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "保存中…" : "事前情報を保存"}
        </button>
        {needLogin && (
          <button className="btn orange" type="button" onClick={goLogin}>
            ログインし直す（入力内容は保持されます）
          </button>
        )}
      </div>
    </form>
  );
}
