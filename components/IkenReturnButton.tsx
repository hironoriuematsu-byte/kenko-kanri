"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// 実施者: 意見聴取の結果を返却済みにして、事業者担当者にメールで知らせる
export default function IkenReturnButton({ companyId, companyName, unjudged }: { companyId: string; companyName: string; unjudged: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async () => {
    setMsg(null);
    setBusy(true);
    try {
      const pre = await fetch("/api/iken/return", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, preview: true }),
      });
      const pj = await pre.json().catch(() => ({}));
      if (!pre.ok) {
        setMsg(pj.error ?? "送り先を確認できませんでした");
        return;
      }
      const names: string[] = pj.names ?? [];
      const warn = unjudged > 0 ? `\n\n※ 就業判定が未入力・判定保留の方が ${unjudged}名 います。` : "";
      if (
        !window.confirm(
          `${companyName} の健診結果を「返却済み」にして、次の方にメールで知らせます。\n\n${names.join("、") || "(送り先なし。返却済みにするだけです)"}${warn}\n\nよろしいですか？`
        )
      )
        return;
      const res = await fetch("/api/iken/return", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(j.error ?? "返却できませんでした");
        return;
      }
      setMsg(`返却済みにしました(メール ${j.sent}/${j.recipients}通)`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <span>
      <button type="button" className="btn orange" onClick={run} disabled={busy} style={{ padding: "6px 12px", fontSize: 13 }}>
        {busy ? "処理中…" : "返却してメール"}
      </button>
      {msg && <span className="muted" style={{ marginLeft: 8 }}>{msg}</span>}
    </span>
  );
}
