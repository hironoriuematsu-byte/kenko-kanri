"use client";

import { FormEvent, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

// 面談の事前情報(office/company共有・従業員本人には非表示)。RPC経由で読み書き
export default function PreInfoPanel({ interviewId }: { interviewId: string }) {
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

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
        setLoaded(true);
      });
  }, [interviewId]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const supabase = createClient();
    const { error } = await supabase.rpc("hm_save_interview_pre_info", {
      p_id: interviewId,
      p_text: text,
    });
    if (error) {
      setError(`保存に失敗しました: ${error.message}`);
    } else {
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
          onChange={(e) => setText(e.target.value)}
          placeholder={
            "面談前に共有しておきたい情報を記入してください。\n例: 直近3か月の時間外労働時間、勤怠状況(遅刻・欠勤等)、相談に至った経緯、職場での様子 など"
          }
          style={{ minHeight: 120 }}
        />
      </div>
      {error && <p className="error-message">{error}</p>}
      {saved && <p style={{ color: "var(--teal-dark)", fontSize: 13 }}>保存しました。</p>}
      <button className="btn" type="submit" disabled={busy}>
        {busy ? "保存中…" : "事前情報を保存"}
      </button>
    </form>
  );
}
