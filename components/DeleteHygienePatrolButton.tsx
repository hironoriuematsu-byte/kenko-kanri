"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

export default function DeleteHygienePatrolButton({
  patrolId,
  backHref,
}: {
  patrolId: string;
  backHref: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onDelete = async () => {
    const reason = window.prompt(
      "巡視記録を削除します。理由を入力してください（ログに記録されます）:"
    );
    if (!reason) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("hm_delete_hygiene_patrol", {
      p_id: patrolId,
      p_reason: reason,
    });
    if (error) {
      alert(`削除に失敗しました: ${error.message}`);
      setBusy(false);
      return;
    }
    router.replace(backHref);
    router.refresh();
  };

  return (
    <button className="btn danger" onClick={onDelete} disabled={busy}>
      {busy ? "削除中…" : "削除(office限定)"}
    </button>
  );
}
