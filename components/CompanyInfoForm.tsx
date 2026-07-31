"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

// 企業補足情報(住所等)の編集。文書(診療情報提供依頼書等)の記載に使われる
export default function CompanyInfoForm({
  companyId,
  initial,
}: {
  companyId: string;
  initial: { address: string; tel: string };
}) {
  const router = useRouter();
  const [address, setAddress] = useState(initial.address);
  const [tel, setTel] = useState(initial.tel);
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
        address: address.trim() || null,
        tel: tel.trim() || null,
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
    <form onSubmit={onSubmit}>
      <div className="form-row">
        <label>所在地（診療情報提供依頼書などの文書に記載されます）</label>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="例: 東京都千代田区○○1-2-3"
        />
      </div>
      <div className="form-row">
        <label>電話番号（任意）</label>
        <input
          type="text"
          value={tel}
          onChange={(e) => setTel(e.target.value)}
          style={{ maxWidth: 240 }}
        />
      </div>
      {error && <p className="error-message">{error}</p>}
      {saved && <p style={{ color: "var(--teal-dark)", fontSize: 13 }}>保存しました。</p>}
      <button className="btn" type="submit" disabled={busy}>
        {busy ? "保存中…" : "企業情報を保存"}
      </button>
    </form>
  );
}
