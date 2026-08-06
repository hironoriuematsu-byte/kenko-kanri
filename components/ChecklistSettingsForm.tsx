"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import {
  CHECKLIST_TYPES,
  DEFAULT_FACTORY_ITEMS,
  DEFAULT_OFFICE_ITEMS,
} from "@/lib/hygiene";

// チェックリスト項目の編集(1行1項目)。工場用/オフィス用それぞれ企業ごとに保存
export default function ChecklistSettingsForm({
  companyId,
  initial,
}: {
  companyId: string;
  initial: Record<string, string[]>;
}) {
  const router = useRouter();
  const [factoryText, setFactoryText] = useState((initial.factory ?? []).join("\n"));
  const [officeText, setOfficeText] = useState((initial.office ?? []).join("\n"));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const supabase = createClient();

    for (const [type, text] of [
      ["factory", factoryText],
      ["office", officeText],
    ] as const) {
      const items = text
        .split(/\r?\n/)
        .map((t) => t.trim())
        .filter(Boolean);
      const { error: delErr } = await supabase
        .from("hm_checklist_items")
        .delete()
        .eq("company_id", companyId)
        .eq("checklist_type", type);
      if (delErr) {
        setError(`保存に失敗しました: ${delErr.message}`);
        setBusy(false);
        return;
      }
      if (items.length > 0) {
        const { error: insErr } = await supabase.from("hm_checklist_items").insert(
          items.map((item_text, i) => ({
            company_id: companyId,
            checklist_type: type,
            item_text,
            sort_order: i,
          }))
        );
        if (insErr) {
          setError(`保存に失敗しました: ${insErr.message}`);
          setBusy(false);
          return;
        }
      }
    }
    setSaved(true);
    setBusy(false);
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit}>
      <p className="muted">
        1行に1項目を記入してください。行の追加・削除・並べ替えで自由に編集できます
        （変更しても過去の巡視記録には影響しません）。
      </p>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div className="form-row" style={{ flex: 1, minWidth: 280 }}>
          <label>
            {CHECKLIST_TYPES.factory}{" "}
            {!factoryText && (
              <button
                type="button"
                className="btn secondary"
                style={{ padding: "2px 10px", fontSize: 12, marginLeft: 8 }}
                onClick={() => setFactoryText(DEFAULT_FACTORY_ITEMS.join("\n"))}
              >
                標準項目を挿入
              </button>
            )}
          </label>
          <textarea
            value={factoryText}
            onChange={(e) => setFactoryText(e.target.value)}
            style={{ minHeight: 220 }}
          />
        </div>
        <div className="form-row" style={{ flex: 1, minWidth: 280 }}>
          <label>
            {CHECKLIST_TYPES.office}{" "}
            {!officeText && (
              <button
                type="button"
                className="btn secondary"
                style={{ padding: "2px 10px", fontSize: 12, marginLeft: 8 }}
                onClick={() => setOfficeText(DEFAULT_OFFICE_ITEMS.join("\n"))}
              >
                標準項目を挿入
              </button>
            )}
          </label>
          <textarea
            value={officeText}
            onChange={(e) => setOfficeText(e.target.value)}
            style={{ minHeight: 220 }}
          />
        </div>
      </div>
      {error && <p className="error-message">{error}</p>}
      {saved && <p style={{ color: "var(--teal-dark)", fontSize: 13 }}>保存しました。</p>}
      <button className="btn" type="submit" disabled={busy}>
        {busy ? "保存中…" : "チェックリストを保存"}
      </button>
    </form>
  );
}
