"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

// 実施記録+産業医非公開メモ(officeのみ)。
// 列単位GRANTで保護されており、読み書きは必ずRPC経由(閲覧もログに記録される)
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
  const [findings, setFindings] = useState("");
  const [guidance, setGuidance] = useState("");
  const [privateMemo, setPrivateMemo] = useState("");
  const [markDone, setMarkDone] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

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
            setConductedDate(r.conducted_date ?? defaultDate ?? "");
            setFindings(r.findings ?? "");
            setGuidance(r.guidance ?? "");
            setPrivateMemo(r.private_memo ?? "");
          }
        }
        setLoaded(true);
      });
  }, [interviewId, defaultDate]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const supabase = createClient();
    const { error } = await supabase.rpc("hm_save_interview_record", {
      p_id: interviewId,
      p_conducted_date: conductedDate || null,
      p_findings: findings || null,
      p_guidance: guidance || null,
      p_private_memo: privateMemo || null,
      p_mark_done: markDone,
    });
    if (error) {
      setError(`保存に失敗しました: ${error.message}`);
    } else {
      setSaved(true);
      router.refresh();
    }
    setBusy(false);
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
        <label>所見</label>
        <textarea value={findings} onChange={(e) => setFindings(e.target.value)} />
      </div>
      <div className="form-row">
        <label>本人への指導内容</label>
        <textarea value={guidance} onChange={(e) => setGuidance(e.target.value)} />
      </div>
      <div className="form-row">
        <label style={{ color: "var(--orange)" }}>
          産業医の非公開メモ（企業側には一切表示されません）
        </label>
        <textarea
          value={privateMemo}
          onChange={(e) => setPrivateMemo(e.target.value)}
          style={{ background: "var(--orange-light)" }}
        />
      </div>
      <div className="form-row checkbox-row">
        <input
          id="markdone"
          type="checkbox"
          checked={markDone}
          onChange={(e) => setMarkDone(e.target.checked)}
        />
        <label htmlFor="markdone" style={{ margin: 0 }}>
          この面談を「実施済」にする
        </label>
      </div>
      {error && <p className="error-message">{error}</p>}
      {saved && <p style={{ color: "var(--teal-dark)", fontSize: 13 }}>保存しました。</p>}
      <button className="btn" type="submit" disabled={busy}>
        {busy ? "保存中…" : "実施記録を保存"}
      </button>
    </form>
  );
}
