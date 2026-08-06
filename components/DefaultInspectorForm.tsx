"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

// 衛生管理者(巡視者)氏名のデフォルト設定。新規作成時に自動入力される
export default function DefaultInspectorForm({
  companyId,
  initial,
}: {
  companyId: string;
  initial: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial);
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
        default_inspector_name: name.trim() || null,
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
    <form onSubmit={onSubmit} style={{ marginBottom: 18 }}>
      <div className="form-row" style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <label>衛生管理者（巡視者）氏名のデフォルト</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: 佐藤 花子"
            style={{ width: 240 }}
          />
        </div>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "保存中…" : "保存"}
        </button>
        {saved && <span style={{ color: "var(--teal-dark)", fontSize: 13 }}>保存しました。</span>}
      </div>
      {error && <p className="error-message">{error}</p>}
    </form>
  );
}
