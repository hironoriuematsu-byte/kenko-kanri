"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startNavigationProgress } from "@/lib/navigate";
import { createClient } from "@/lib/supabase/browser";

// 産業医作成文書(診療情報提供依頼書など)の削除。officeのみ。
// 理由の入力を必須にし、RPC(0139)経由で削除してアクセスログに残す
export default function DeleteDocumentButton({
  documentId,
  title,
  backHref,
}: {
  documentId: string;
  title: string;
  backHref: string; // 削除後に戻る画面(カルテ)
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDelete = async () => {
    const reason = window.prompt(
      `「${title}」を削除します。この操作は取り消せません。\n削除する理由を入力してください(操作はログに記録されます):`
    );
    if (!reason) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("hm_delete_person_document", { p_id: documentId, p_reason: reason });
    if (error) {
      setError(
        /function|schema cache/i.test(error.message)
          ? "削除の設定(SQL 0139)が未実行です。SQL Editor で実行してください。"
          : `削除に失敗しました: ${error.message}`
      );
      setBusy(false);
      return;
    }
    startNavigationProgress();
    router.replace(backHref);
  };

  return (
    <div style={{ marginTop: 24, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
      <p className="muted" style={{ fontSize: 12.5, margin: "0 0 8px" }}>
        この文書を削除します（実施者のみ）。削除すると元に戻せません。印刷した控えがある場合はお手元で管理してください。
      </p>
      {error && <p className="error-message">{error}</p>}
      <button className="btn danger" type="button" onClick={onDelete} disabled={busy}>
        {busy ? "削除中…" : "この文書を削除する"}
      </button>
    </div>
  );
}
