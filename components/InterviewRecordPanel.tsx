"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { clearDraft, ensureSession, isAuthError, saveDraft, takeDraft } from "@/lib/session";
import VoiceInputButton, { appendText } from "@/components/VoiceInputButton";

// 実施記録(産業医事務所のみ。企業には共有されない)。
// 列単位GRANTで保護されており、読み書きは必ずRPC経由(閲覧もログに記録される)。
// 所見・指導内容・非公開メモは1つの欄にまとめる(以前は3つの欄。過去の記録は結合して表示する)。
// 入力が止まって数秒たつと自動で保存する。面談を「実施済」にするのは意見書の公開時(OpinionPanel)
const AUTOSAVE_DELAY_MS = 4000;

export default function InterviewRecordPanel({
  interviewId,
  defaultDate,
}: {
  interviewId: string;
  defaultDate?: string; // 面談予定日(YYYY-MM-DD)。実施日の初期値に使う
}) {
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [conductedDate, setConductedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needLogin, setNeedLogin] = useState(false);
  const draftKey = `interview-record:${interviewId}`;
  // 最後にサーバーへ保存した内容(変わっていなければ自動保存しない)
  const lastSaved = useRef<{ date: string; notes: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .rpc("hm_get_interview_record", { p_id: interviewId })
      .then(({ data, error }) => {
        if (error) {
          setError(`実施記録の取得に失敗しました: ${error.message}`);
        } else {
          const r = Array.isArray(data) ? data[0] : data;
          if (r) {
            // 未入力なら面談予定日を既定値にする(変更可)
            const date = r.conducted_date ?? defaultDate ?? "";
            const merged = [r.findings, r.guidance, r.private_memo]
              .filter((s: string | null) => (s ?? "").trim() !== "")
              .join("\n\n");
            setConductedDate(date);
            setNotes(merged);
            lastSaved.current = { date: r.conducted_date ?? "", notes: merged };
          }
        }
        // 再ログイン前に残しておいた未保存の入力があれば復元する
        const draft = takeDraft(draftKey);
        if (draft !== null) {
          setNotes(draft);
          setStatus("未保存の入力内容を復元しました。");
        }
        setLoaded(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewId, defaultDate]);

  const save = useCallback(
    async (auto: boolean) => {
      const current = { date: conductedDate, notes };
      if (auto && lastSaved.current && lastSaved.current.date === current.date && lastSaved.current.notes === current.notes) {
        return; // 変わっていない
      }
      setBusy(true);
      setError(null);
      const supabase = createClient();
      // 長い入力中にログインの有効期限が切れていることがあるため、保存前に確認・更新する
      const ok = await ensureSession(supabase);
      if (!ok) {
        saveDraft(draftKey, notes);
        setNeedLogin(true);
        setError("ログインの有効期限が切れています。入力内容はこの画面に保持されますので、下のボタンからログインし直してください。");
        setBusy(false);
        return;
      }
      const { error } = await supabase.rpc("hm_save_interview_record", {
        p_id: interviewId,
        p_conducted_date: current.date || null,
        p_findings: current.notes || null,
        p_guidance: null,
        p_private_memo: null,
        p_mark_done: false,
      });
      if (error) {
        if (isAuthError(error.message)) {
          saveDraft(draftKey, notes);
          setNeedLogin(true);
          setError("ログインの有効期限が切れています。入力内容はこの画面に保持されますので、下のボタンからログインし直してください。");
        } else {
          setError(`保存に失敗しました: ${error.message}`);
        }
      } else {
        lastSaved.current = current;
        clearDraft(draftKey);
        setNeedLogin(false);
        const t = new Date();
        const hm = `${t.getHours()}:${String(t.getMinutes()).padStart(2, "0")}`;
        setStatus(auto ? `自動保存しました（${hm}）` : `保存しました（${hm}）`);
        if (!auto) router.refresh();
      }
      setBusy(false);
    },
    [conductedDate, notes, interviewId, draftKey, router]
  );

  // 入力が止まってしばらくしたら自動保存する
  useEffect(() => {
    if (!loaded) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(true), AUTOSAVE_DELAY_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [conductedDate, notes, loaded, save]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (timer.current) clearTimeout(timer.current);
    await save(false);
  };

  // 期限切れのとき: 入力内容を残してログイン画面へ。ログイン後はこの画面に戻る
  const goLogin = () => {
    saveDraft(draftKey, notes);
    const next = encodeURIComponent(window.location.pathname);
    window.location.href = `/login?next=${next}`;
  };

  if (!loaded) return <p className="muted">実施記録を読み込み中…</p>;

  return (
    <form onSubmit={onSubmit}>
      <div className="form-row">
        <label>実施日</label>
        <input
          type="date"
          value={conductedDate}
          onChange={(e) => setConductedDate(e.target.value)}
        />
      </div>
      <div className="form-row">
        <label style={{ color: "var(--orange)" }}>
          所見と指導内容（産業医事務所のみ・企業側には一切表示されません）
          <VoiceInputButton
            onAppend={(t) => {
              setNotes((prev) => appendText(prev, t));
              setStatus(null);
            }}
          />
        </label>
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setStatus(null);
          }}
          onBlur={() => save(true)}
          style={{ background: "var(--orange-light)", minHeight: 160 }}
          placeholder="面談での所見、本人への指導内容、メモなど。入力が止まると自動で保存されます。"
        />
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        面談を「実施済」にするには、下の意見書で「企業側に公開し、面談を実施済にする」を付けて保存してください。
      </p>
      {error && <p className="error-message">{error}</p>}
      {status && <p style={{ color: "var(--teal-dark)", fontSize: 13 }}>{status}</p>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "保存中…" : "実施記録を保存"}
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
