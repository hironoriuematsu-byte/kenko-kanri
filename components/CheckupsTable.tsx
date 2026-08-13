"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { formatDateJa } from "@/lib/fiscal";
import { CHECKUP_TYPES, FOLLOWUP_STATUS, isSevereJudgment } from "@/lib/checkups";
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
  findingItems?: { item_name: string; judgment: string | null }[];
};

// 健診一覧。officeは有所見項目の表示・一括就業判定・一括削除が可能
export default function CheckupsTable({
  rows,
  canDelete,
  canJudge = false,
}: {
  rows: CheckupRow[];
  canDelete: boolean;
  canJudge?: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [judgment, setJudgment] = useState("restricted");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // A/B/C かつ未判定 = 「通常勤務可」を一括適用できる対象
  const normalTargets = useMemo(
    () => rows.filter((r) => !r.work_judgment && !isSevereJudgment(r.overall_judgment)),
    [rows]
  );
  // D/E = 個別に判断が必要な対象
  const severeRows = useMemo(
    () => rows.filter((r) => isSevereJudgment(r.overall_judgment)),
    [rows]
  );

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

  const runBulkJudgment = async (ids: string[], value: string, noteText: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("hm_bulk_work_judgment", {
      p_ids: ids,
      p_judgment: value,
      p_note: noteText || null,
    });
    if (error) {
      setError(`一括判定に失敗しました: ${error.message}`);
      setBusy(false);
      return;
    }
    setMessage(`${data}名の就業判定を「${WORK_JUDGMENTS[value]}」で登録しました（判定日は本日）。`);
    setSelected(new Set());
    setNote("");
    setBusy(false);
    router.refresh();
  };

  const onNormalBulk = async () => {
    if (normalTargets.length === 0) return;
    const ok = window.confirm(
      `総合判定がA・B・Cで未判定の ${normalTargets.length}名を、まとめて「通常勤務可」で判定します。\n判定日は本日として記録されます。よろしいですか？`
    );
    if (!ok) return;
    await runBulkJudgment(
      normalTargets.map((r) => r.id),
      "normal",
      ""
    );
  };

  const onSelectedBulk = async () => {
    if (selected.size === 0) return;
    const ok = window.confirm(
      `選択した ${selected.size}名を「${WORK_JUDGMENTS[judgment]}」で判定します。\n判定日は本日として記録されます。よろしいですか？`
    );
    if (!ok) return;
    await runBulkJudgment(Array.from(selected), judgment, note);
  };

  const onSelectSevereUnjudged = () =>
    setSelected(new Set(severeRows.filter((r) => !r.work_judgment).map((r) => r.id)));

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
    const reason = window.prompt("削除する理由を入力してください（監査ログに記録されます）:");
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
    setMessage(`${data}件を削除しました。`);
    router.refresh();
  };

  const showCheckbox = canDelete || canJudge;

  return (
    <div>
      {canJudge && (
        <div
          className="card"
          style={{ background: "var(--teal-light)", borderColor: "var(--teal)", padding: "14px 18px" }}
        >
          <strong style={{ color: "var(--teal-dark)", fontSize: 14 }}>就業判定の一括入力</strong>
          <p className="muted" style={{ margin: "4px 0 10px" }}>
            判定日は実行した当日が自動で記録されます。
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn" onClick={onNormalBulk} disabled={busy || normalTargets.length === 0}>
              A・B・Cの未判定 {normalTargets.length}名を「通常勤務可」で一括判定
            </button>
            {severeRows.length > 0 && (
              <button className="btn secondary" onClick={onSelectSevereUnjudged} disabled={busy}>
                D・Eの未判定を選択（{severeRows.filter((r) => !r.work_judgment).length}名）
              </button>
            )}
          </div>

          {selected.size > 0 && (
            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                alignItems: "flex-end",
                marginTop: 12,
                paddingTop: 12,
                borderTop: "1px solid var(--teal)",
              }}
            >
              <div>
                <label className="muted" style={{ display: "block", fontSize: 12 }}>
                  選択中 {selected.size}名の判定
                </label>
                <select value={judgment} onChange={(e) => setJudgment(e.target.value)}>
                  {Object.entries(WORK_JUDGMENTS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label className="muted" style={{ display: "block", fontSize: 12 }}>
                  医師の意見（任意・選択者に共通で入ります）
                </label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="時間外労働の制限、就業時間の短縮 など"
                />
              </div>
              <button className="btn orange" onClick={onSelectedBulk} disabled={busy}>
                {busy ? "処理中…" : "選択者をまとめて判定"}
              </button>
            </div>
          )}
        </div>
      )}

      {canDelete && selected.size > 0 && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
          <span className="muted">{selected.size}件選択中</span>
          <button className="btn danger" onClick={onBulkDelete} disabled={busy}>
            {busy ? "処理中…" : "選択した記録を一括削除(office限定)"}
          </button>
        </div>
      )}
      {error && <p className="error-message">{error}</p>}
      {message && <p style={{ color: "var(--teal-dark)", fontSize: 13 }}>{message}</p>}

      <table className="list">
        <thead>
          <tr>
            {showCheckbox && (
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
            <th>有所見項目</th>
            <th>就業判定</th>
            <th>事後措置</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              {showCheckbox && (
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
              <td>
                {c.overall_judgment ? (
                  isSevereJudgment(c.overall_judgment) ? (
                    <strong style={{ color: "var(--danger)" }}>{c.overall_judgment}</strong>
                  ) : (
                    c.overall_judgment
                  )
                ) : (
                  "—"
                )}
              </td>
              <td style={{ fontSize: 13 }}>
                {c.findingItems && c.findingItems.length > 0 ? (
                  c.findingItems.map((it, i) => (
                    <span key={i} className="badge orange" style={{ marginRight: 4 }}>
                      {it.item_name}
                      {it.judgment ? `(${it.judgment})` : ""}
                    </span>
                  ))
                ) : c.has_findings ? (
                  <span className="badge orange">有所見</span>
                ) : (
                  "—"
                )}
              </td>
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
