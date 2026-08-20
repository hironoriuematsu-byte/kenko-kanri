"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import type { OfficeInfo } from "@/components/CheckupReportPanel";

// 産業医事務所の情報(帳票・CSVに記載)の編集。officeのみ
export default function OfficeInfoForm({ initial }: { initial: OfficeInfo | null }) {
  const router = useRouter();
  const [officeName, setOfficeName] = useState(initial?.office_name ?? "うえまつ産業医事務所");
  const [physician, setPhysician] = useState(initial?.physician_name ?? "上松弘典");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [tel, setTel] = useState(initial?.tel ?? "");
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
    const { error } = await supabase.from("hm_office_info").upsert(
      {
        id: "default",
        office_name: officeName.trim() || "うえまつ産業医事務所",
        physician_name: physician.trim() || "上松弘典",
        address: address.trim() || null,
        tel: tel.trim() || null,
        updated_by: user.user?.id,
      },
      { onConflict: "id" }
    );
    if (error) setError(`保存に失敗しました: ${error.message}`);
    else {
      setSaved(true);
      router.refresh();
    }
    setBusy(false);
  };

  return (
    <form onSubmit={onSubmit}>
      <div className="form-row" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <label>事務所名</label>
          <input
            type="text"
            value={officeName}
            onChange={(e) => setOfficeName(e.target.value)}
          />
        </div>
        <div>
          <label>産業医氏名（敬称は付けません）</label>
          <input
            type="text"
            value={physician}
            onChange={(e) => setPhysician(e.target.value)}
            style={{ width: 200 }}
          />
        </div>
      </div>
      <div className="form-row" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <label>所在地</label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="例: 東京都千代田区○○1-2-3"
          />
        </div>
        <div>
          <label>電話番号（任意）</label>
          <input
            type="text"
            value={tel}
            onChange={(e) => setTel(e.target.value)}
            style={{ width: 180 }}
          />
        </div>
      </div>
      {error && <p className="error-message">{error}</p>}
      {saved && <p style={{ color: "var(--teal-dark)", fontSize: 13 }}>保存しました。</p>}
      <button className="btn" type="submit" disabled={busy}>
        {busy ? "保存中…" : "事務所情報を保存"}
      </button>
    </form>
  );
}
