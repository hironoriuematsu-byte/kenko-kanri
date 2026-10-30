"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

// 主な業務内容・勤務形態(医師が意見を述べるために提供する情報)の変更
export default function IkenWorkInfoForm({ companyId, initial, readOnly }: { companyId: string; initial: string; readOnly?: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const { error } = await createClient().rpc("hm_iken_set_work_info", { p_company_id: companyId, p_work_info: value });
    setBusy(false);
    if (error) {
      setMsg(`保存できませんでした: ${error.message}`);
      return;
    }
    setMsg("保存しました");
    router.refresh();
  };

  if (readOnly) return <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{initial || "(未入力)"}</p>;
  return (
    <div>
      <textarea value={value} onChange={(e) => setValue(e.target.value)} style={{ minHeight: 90 }} />
      <button type="button" className="btn secondary" onClick={save} disabled={busy || value === initial} style={{ marginTop: 6 }}>
        {busy ? "保存しています…" : "保存"}
      </button>
      {msg && <span className="muted" style={{ marginLeft: 10 }}>{msg}</span>}
    </div>
  );
}
