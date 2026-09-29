"use client";

import { FormEvent, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { clearDraft, ensureSession, isAuthError, saveDraft, takeDraft } from "@/lib/session";

// 面談の事前情報(office/company共有・従業員本人には非表示)。RPC経由で読み書き
export default function PreInfoPanel({ interviewId }: { interviewId: string }) {
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [needLogin, setNeedLogin] = useState(false);
  const draftKey = `pre-info:${interviewId}`;

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
        }
        // 再ログイン前に残しておいた未保存の入力があれば復元する
        const draft = takeDraft(draftKey);
        if (draft !== null && draft !== ((data as string) ?? "")) {
          setText(draft);
          setNotice("未保存の入力内容を復元しました。内容を確認して「事前情報を保存」を押してください。");
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

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    setSaved(false);
    const supabase = createClient();

    // 長時間の入力でログインの有効期限が切れていることがあるため、保存前に確認・更新する
    const ok = await ensureSession(supabase);
    if (!ok) {
      saveDraft(draftKey, text);
      setNeedLogin(true);
      setError("ログインの有効期限が切れています。入力内容はこの画面に保持されますので、下のボタンからログインし直して再度保存してください。");
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
        setError("ログインの有効期限が切れています。入力内容はこの画面に保持されますので、下のボタンからログインし直して再度保存してください。");
      } else {
        setError(`保存に失敗しました: ${error.message}`);
      }
    } else {
      clearDraft(draftKey);
      setNeedLogin(false);
      setSaved(true);
    }
    setBusy(false);
  };

  if (!loaded) return <p className="muted">事前情報を読み込み中…</p>;

  return (
    <form onSubmit={onSubmit}>
      <div className="form-row">
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setSaved(false);
          }}
          placeholder={
            "面談前に共有しておきたい情報を記入してください。\n例: 直近3か月の時間外労働時間、勤怠状況(遅刻・欠勤等)、相談に至った経緯、職場での様子 など"
          }
          style={{ minHeight: 120 }}
        />
      </div>
      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error-message">{error}</p>}
      {saved && <p style={{ color: "var(--teal-dark)", fontSize: 13 }}>保存しました。</p>}
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
