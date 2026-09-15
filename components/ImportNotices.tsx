"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { CHECKUP_TYPES, roundLabel } from "@/lib/checkups";

type Notice = {
  batch_id: string;
  company_id: string;
  company_name: string;
  fiscal_year: number;
  round: number;
  checkup_type: string;
  special_kind: string | null;
  count: number;
  merged: number;
  imported_by_name: string | null;
  imported_by_role: string | null;
  created_at: string;
};

const ROLE_LABEL: Record<string, string> = {
  company: "事業者担当者",
  office: "実施者",
};

// 産業医事務所ダッシュボード: 事業者担当者などが取り込んだ健診結果の通知。
// 実施者が「確認」を押すまで残る(0134 hm_import_notices)
export default function ImportNotices() {
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("hm_import_notices_pending");
    if (error) {
      // 0134 未適用のときは何も出さない
      setNotices([]);
      return;
    }
    setNotices((data ?? []) as Notice[]);
  };

  useEffect(() => {
    load();
  }, []);

  const confirm = async (batchId: string) => {
    setBusy(batchId);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("hm_confirm_import_notice", { p_batch: batchId });
    if (error) setError(`確認済みにできませんでした: ${error.message}`);
    else await load();
    setBusy(null);
  };

  if (!notices || notices.length === 0) return null;

  const fmt = (ts: string) => {
    const d = new Date(ts);
    return isNaN(d.getTime())
      ? ts
      : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <div className="card" style={{ borderColor: "var(--orange)" }}>
      <h2>健診結果の取込があります（未確認 {notices.length}件）</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        事業者担当者などが取り込んだ健診結果です。内容を確認して就業判定を行ってください。
        「確認」を押すとこの一覧から消えます。
      </p>
      {error && <p className="error-message">{error}</p>}
      <table className="list">
        <thead>
          <tr>
            <th>取込日時</th>
            <th>企業</th>
            <th>対象</th>
            <th>人数</th>
            <th>取り込んだ方</th>
            <th style={{ width: 200 }}></th>
          </tr>
        </thead>
        <tbody>
          {notices.map((n) => (
            <tr key={n.batch_id}>
              <td style={{ whiteSpace: "nowrap" }}>{fmt(n.created_at)}</td>
              <td>{n.company_name}</td>
              <td>
                {n.fiscal_year}年度{roundLabel(n.round) ? `・${roundLabel(n.round)}` : ""} /{" "}
                {CHECKUP_TYPES[n.checkup_type] ?? n.checkup_type}
                {n.special_kind ? `（${n.special_kind}）` : ""}
              </td>
              <td>
                {n.count}名
                {n.merged > 0 && (
                  <span className="muted" style={{ fontSize: 12 }}>（うち統合 {n.merged}名）</span>
                )}
              </td>
              <td>
                {n.imported_by_name ?? "—"}
                {n.imported_by_role && (
                  <span className="muted" style={{ fontSize: 12, marginLeft: 4 }}>
                    （{ROLE_LABEL[n.imported_by_role] ?? n.imported_by_role}）
                  </span>
                )}
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                <Link
                  className="btn secondary"
                  style={{ padding: "4px 10px", fontSize: 12, marginRight: 6 }}
                  href={`/office/${n.company_id}/checkups?year=${n.fiscal_year}${n.round > 1 ? `&round=${n.round}` : ""}`}
                >
                  一覧を開く
                </Link>
                <button
                  className="btn"
                  style={{ padding: "4px 10px", fontSize: 12 }}
                  onClick={() => confirm(n.batch_id)}
                  disabled={busy === n.batch_id}
                >
                  {busy === n.batch_id ? "処理中…" : "確認"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
