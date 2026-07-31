"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

export default function DeletePersonButton({
  personId,
  personName,
  backHref,
}: {
  personId: string;
  personName: string;
  backHref: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onDelete = async () => {
    const ok = window.confirm(
      `【注意】「${personName}」のカルテを削除します。\n添付書類・作成文書の記録も削除されます。この操作は元に戻せません。続行しますか？`
    );
    if (!ok) return;
    const reason = window.prompt("削除する理由を入力してください（ログに記録されます）:");
    if (!reason) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("hm_delete_person", {
      p_id: personId,
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
      {busy ? "削除中…" : "カルテを削除(office限定)"}
    </button>
  );
}
