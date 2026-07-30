"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { FOLLOWUP_STATUS } from "@/lib/checkups";

// 事後措置フォロー(再検査・受診勧奨)の状況管理: office / company(自社)
export default function FollowupPanel({
  checkupId,
  initial,
}: {
  checkupId: string;
  initial: { status: string; note: string };
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initial.status);
  const [note, setNote] = useState(initial.note);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const supabase = createClient();
    const { error } = await supabase.rpc("hm_set_followup", {
      p_id: checkupId,
      p_status: status,
      p_note: note || null,
    });
    if (error) {
      setError(`保存に失敗しました: ${error.message}`);
    } else {
      setSaved(true);
      router.refresh();
    }
    setBusy(false);
  };

  return (
    <form onSubmit={onSubmit}>
      <div className="form-row">
        <label>状況</label>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {Object.entries(FOLLOWUP_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label>メモ（再検査項目、勧奨日など）</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{ minHeight: 70 }}
        />
      </div>
      {error && <p className="error-message">{error}</p>}
      {saved && <p style={{ color: "var(--teal-dark)", fontSize: 13 }}>保存しました。</p>}
      <button className="btn" type="submit" disabled={busy}>
        {busy ? "保存中…" : "事後措置の状況を保存"}
      </button>
    </form>
  );
}
