"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

export default function CancelInterviewButton({ interviewId }: { interviewId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onCancel = async () => {
    const reason = window.prompt("面談を中止にします。理由を入力してください（ログに記録されます）:");
    if (!reason) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("hm_cancel_interview", {
      p_id: interviewId,
      p_reason: reason,
    });
    if (error) {
      alert(`中止処理に失敗しました: ${error.message}`);
      setBusy(false);
      return;
    }
    router.refresh();
  };

  return (
    <button className="btn danger" onClick={onCancel} disabled={busy}>
      {busy ? "処理中…" : "面談を中止にする"}
    </button>
  );
}
