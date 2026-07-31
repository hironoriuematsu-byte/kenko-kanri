"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

// 会社名の隣に所在地を表示。未登録なら入力欄、登録済みなら「編集」で変更可
export default function CompanyAddressInline({
  companyId,
  initialAddress,
}: {
  companyId: string;
  initialAddress: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(!initialAddress);
  const [address, setAddress] = useState(initialAddress);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data: user } = await supabase.auth.getUser();
    const { error } = await supabase.from("hm_company_info").upsert(
      {
        company_id: companyId,
        address: address.trim() || null,
        updated_by: user.user?.id,
      },
      { onConflict: "company_id" }
    );
    if (error) {
      setError(`保存に失敗しました: ${error.message}`);
    } else {
      setEditing(!address.trim());
      router.refresh();
    }
    setBusy(false);
  };

  if (!editing) {
    return (
      <span style={{ fontSize: 14, color: "var(--muted)" }}>
        {address}
        <button
          className="btn secondary"
          style={{ padding: "2px 10px", fontSize: 12, marginLeft: 8 }}
          onClick={() => setEditing(true)}
        >
          編集
        </button>
      </span>
    );
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <input
        type="text"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="所在地を入力（例: 東京都千代田区○○1-2-3）"
        style={{ width: 320, fontSize: 13, padding: "5px 8px" }}
      />
      <button className="btn" type="submit" disabled={busy} style={{ padding: "5px 12px", fontSize: 12 }}>
        {busy ? "保存中…" : "保存"}
      </button>
      {error && <span className="error-message">{error}</span>}
    </form>
  );
}
