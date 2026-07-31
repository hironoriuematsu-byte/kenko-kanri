"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

// 議事録の企業別デフォルト設定(委員会名・出席者)。office / company(自社)
export default function MinutesSettingsForm({
  companyId,
  initial,
}: {
  companyId: string;
  initial: { committee_name: string; default_attendees: string };
}) {
  const router = useRouter();
  const [committeeName, setCommitteeName] = useState(
    initial.committee_name || "安全衛生委員会"
  );
  const [attendees, setAttendees] = useState(initial.default_attendees);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const supabase = createClient();
    const { data: user } = await supabase.auth.getUser();
    const { error } = await supabase.from("hm_company_info").upsert(
      {
        company_id: companyId,
        committee_name: committeeName,
        default_attendees: attendees.trim() || null,
        updated_by: user.user?.id,
      },
      { onConflict: "company_id" }
    );
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
        <label>委員会名（新規作成時の件名の初期値になります）</label>
        <select
          value={committeeName}
          onChange={(e) => setCommitteeName(e.target.value)}
          style={{ maxWidth: 240 }}
        >
          <option value="衛生委員会">衛生委員会</option>
          <option value="安全衛生委員会">安全衛生委員会</option>
        </select>
      </div>
      <div className="form-row">
        <label>デフォルトの出席者（新規作成時に自動入力。作成画面で追加・削除できます）</label>
        <textarea
          value={attendees}
          onChange={(e) => setAttendees(e.target.value)}
          placeholder={"委員長: ○○\n衛生管理者: ○○\n産業医: 上松弘典\n委員: ○○、○○"}
          style={{ minHeight: 90 }}
        />
      </div>
      {error && <p className="error-message">{error}</p>}
      {saved && <p style={{ color: "var(--teal-dark)", fontSize: 13 }}>保存しました。</p>}
      <button className="btn" type="submit" disabled={busy}>
        {busy ? "保存中…" : "設定を保存"}
      </button>
    </form>
  );
}
