"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { formatDateJa } from "@/lib/fiscal";
import { CHECKUP_TYPES, FOLLOWUP_STATUS } from "@/lib/checkups";
import { WORK_JUDGMENTS } from "@/lib/interviews";

export type CheckupRow = {
  id: string;
  target_name: string;
  employee_no: string | null;
  checkup_type: string;
  checkup_date: string | null;
  overall_judgment: string | null;
  has_findings: boolean;
  work_judgment: string | null;
  followup_status: string;
};

// 健診一覧テーブル。canDelete(office)の場合はチェックボックス+一括削除つき
export default function CheckupsTable({
  rows,
  canDelete,
}: {
  rows: CheckupRow[];
  canDelete: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) =>
      prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))
    );

  const onBulkDelete = async () => {
    if (selected.size === 0) return;
    const names = rows
      .filter((r) => selected.has(r.id))
      .map((r) => r.target_name)
      .slice(0, 5)
      .join("、");
    const suffix = selected.size > 5 ? " ほか" : "";
    const ok = window.confirm(
      `【注意】選択した ${selected.size} 件の健診記録を完全に削除します。\n` +
        `対象: ${names}${suffix}\n\n` +
        `健康診断個人票は5年保存が原則です。取込ミスの修正など、正当な理由がある場合のみ削除してください。\n` +
        `この操作は元に戻せません。続行しますか？`
    );
    if (!ok) return;
    const reason = window.prompt(
      "削除する理由を入力してください（監査ログに記録されます）:"
    );
    if (!reason) return;

    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("hm_delete_checkups", {
      p_ids: Array.from(selected),
      p_reason: reason,
    });
    if (error) {
      setError(`削除に失敗しました: ${error.message}`);
      setBusy(false);
      return;
    }
    setSelected(new Set());
    setBusy(false);
    alert(`${data}件を削除しました。`);
    router.refresh();
  };

  return (
    <div>
      {canDelete && (
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            marginBottom: 8,
            minHeight: 34,
          }}
        >
          {selected.size > 0 ? (
            <>
              <span className="muted">{selected.size}件選択中</span>
              <button className="btn danger" onClick={onBulkDelete} disabled={busy}>
                {busy ? "削除中…" : "選択した記録を一括削除(office限定)"}
              </button>
            </>
          ) : (
            <span className="muted">
              取込ミスをまとめて削除する場合は、左のチェックボックスで選択してください。
            </span>
          )}
        </div>
      )}
      {error && <p className="error-message">{error}</p>}

      <table className="list">
        <thead>
          <tr>
            {canDelete && (
              <th style={{ width: 34 }}>
                <input
                  type="checkbox"
                  checked={rows.length > 0 && selected.size === rows.length}
                  onChange={toggleAll}
                  aria-label="全選択"
                />
              </th>
            )}
            <th>社員番号</th>
            <th>氏名</th>
            <th>種別</th>
            <th>健診日</th>
            <th>総合判定</th>
            <th>有所見</th>
            <th>就業判定</th>
            <th>事後措置</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              {canDelete && (
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                    aria-label={`${c.target_name}を選択`}
                  />
                </td>
              )}
              <td>{c.employee_no || "—"}</td>
              <td>
                <Link href={`/checkup/${c.id}`}>{c.target_name}</Link>
              </td>
              <td>{CHECKUP_TYPES[c.checkup_type] ?? c.checkup_type}</td>
              <td>{formatDateJa(c.checkup_date)}</td>
              <td>{c.overall_judgment || "—"}</td>
              <td>{c.has_findings ? <span className="badge orange">有</span> : "—"}</td>
              <td>{c.work_judgment ? WORK_JUDGMENTS[c.work_judgment] : "未判定"}</td>
              <td>
                {c.followup_status === "pending" ? (
                  <span className="badge orange">{FOLLOWUP_STATUS[c.followup_status]}</span>
                ) : (
                  FOLLOWUP_STATUS[c.followup_status] ?? "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
