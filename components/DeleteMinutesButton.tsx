"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

// 議事録の削除は保存年限(3年以上)のため原則不可。
// officeのみの例外操作として、理由の入力を必須にしRPC経由で論理削除する。
export default function DeleteMinutesButton({ minutesId }: { minutesId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onDelete = async () => {
    const reason = window.prompt(
      "議事録は3年以上の保存が原則です。削除する理由を入力してください(操作はログに記録されます):"
    );
    if (!reason) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("hm_delete_minutes", {
      p_id: minutesId,
      p_reason: reason,
    });
    if (error) {
      alert(`削除に失敗しました: ${error.message}`);
      setBusy(false);
      return;
    }
    router.replace("/office");
    router.refresh();
  };

  return (
    <button className="btn danger" onClick={onDelete} disabled={busy}>
      {busy ? "削除中…" : "削除(office限定)"}
    </button>
  );
}
