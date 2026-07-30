"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

// 健診記録の削除(取込ミス修正用): officeのみ・理由必須・ログ記録
export default function DeleteCheckupButton({
  checkupId,
  backHref,
}: {
  checkupId: string;
  backHref: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onDelete = async () => {
    const reason = window.prompt(
      "健診個人票は5年保存が原則です。削除する理由(取込ミス等)を入力してください(ログに記録されます):"
    );
    if (!reason) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("hm_delete_checkup", {
      p_id: checkupId,
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
