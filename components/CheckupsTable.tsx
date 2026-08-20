"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { formatDateJa } from "@/lib/fiscal";
import {
  CHECKUP_TYPES,
  CHECKUP_WORK_JUDGMENTS,
  OPINION_PRESETS,
  buildOpinionNote,
  isSevereJudgment,
  needsAttention,
  parseOpinionNote,
} from "@/lib/checkups";

export type CheckupRow = {
  id: string;
  target_name: string;
  employee_no: string | null;
  checkup_type: string;
  checkup_date: string | null;
  overall_judgment: string | null;
  has_findings: boolean;
  work_judgment: string | null;
  work_judgment_note: string | null;
  work_judgment_date: string | null;
  findingItems?: { item_name: string; judgment: string | null }[];
};

// 就業判定の表示色
const judgmentStyle = (j: string | null): React.CSSProperties => {
  if (!j) return { color: "var(--danger)", fontWeight: 700 };
  if (j === "pending") return { color: "var(--orange)", fontWeight: 700 };
  if (j === "restricted" || j === "leave") return { color: "var(--danger)", fontWeight: 700 };
  return {};
};

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
  const [bulkPresets, setBulkPresets] = useState<string[]>([]);
  const [bulkFree, setBulkFree] = useState("");
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<{ presets: string[]; freeText: string }>({
    presets: [],
    freeText: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const normalTargets = useMemo(
    () => rows.filter((r) => !r.work_judgment && !isSevereJudgment(r.overall_judgment)),
    [rows]
  );
  const severeRows = useMemo(
    () => rows.filter((r) => isSevereJudgment(r.overall_judgment)),
    [rows]
  );
  const attentionRows = useMemo(() => rows.filter((r) => needsAttention(r.work_judgment)), [rows]);

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

  const runBulkJudgment = async (ids: string[], value: string, note: string | null) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("hm_bulk_work_judgment", {
      p_ids: ids,
      p_judgment: value,
      p_note: note,
    });
    if (error) {
      setError(`一括判定に失敗しました: ${error.message}`);
      setBusy(false);
      return;
    }
    setMessage(
      `${data}名の就業判定を「${CHECKUP_WORK_JUDGMENTS[value]}」で登録しました（判定日は本日）。`
    );
    setSelected(new Set());
    setBulkPresets([]);
    setBulkFree("");
    setBusy(false);
    router.refresh();
  };

  const onNormalBulk = async () => {
    if (normalTargets.length === 0) return;
    const ok = window.confirm(
      `総合判定がA・B・Cで未判定の ${normalTargets.length}名を、まとめて「通常勤務可」で判定します。\n判定日は本日として記録されます。よろしいですか？`
    );
    if (!ok) return;
    await runBulkJudgment(normalTargets.map((r) => r.id), "normal", null);
  };

  const onSelectedBulk = async () => {
    if (selected.size === 0) return;
    const note = buildOpinionNote(bulkPresets, bulkFree);
    const ok = window.confirm(
      `選択した ${selected.size}名を「${CHECKUP_WORK_JUDGMENTS[judgment]}」で判定します。\n${
        note ? `医師の意見: ${note}\n` : ""
      }判定日は本日として記録されます。よろしいですか？`
    );
    if (!ok) return;
    await runBulkJudgment(Array.from(selected), judgment, note || null);
  };

  const onSelectSevereUnjudged = () =>
    setSelected(new Set(severeRows.filter((r) => !r.work_judgment).map((r) => r.id)));

  const onSelectAttention = () => setSelected(new Set(attentionRows.map((r) => r.id)));

  const onRowJudgment = async (id: string, value: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("hm_save_work_judgment", {
      p_id: id,
      p_judgment: value,
      p_note: null,
      p_date: null,
    });
    if (error) setError(`判定の保存に失敗しました: ${error.message}`);
    else router.refresh();
    setBusy(false);
  };

  const startEditNote = (r: CheckupRow) => {
    setEditingNote(r.id);
    setNoteDraft(parseOpinionNote(r.work_judgment_note));
  };

  const saveNote = async (id: string) => {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("hm_save_work_judgment_note", {
      p_id: id,
      p_note: buildOpinionNote(noteDraft.presets, noteDraft.freeText),
    });
    if (error) setError(`医師の意見の保存に失敗しました: ${error.message}`);
    else {
      setEditingNote(null);
      router.refresh();
    }
    setBusy(false);
  };

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

  const presetToggle = (
    list: string[],
    setList: (v: string[]) => void,
    preset: string,
    idPrefix: string
  ) => (
    <label
      key={preset}
      htmlFor={`${idPrefix}-${preset}`}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, marginRight: 10 }}
    >
      <input
        id={`${idPrefix}-${preset}`}
        type="checkbox"
        checked={list.includes(preset)}
        onChange={(e) =>
          setList(e.target.checked ? [...list, preset] : list.filter((p) => p !== preset))
        }
        style={{ width: 15, height: 15 }}
      />
      {preset}
    </label>
  );

  return (
    <div>
      {canJudge && (
        <div
          className="card"
          style={{ background: "var(--teal-light)", borderColor: "var(--teal)", padding: "14px 18px" }}
        >
          <strong style={{ color: "var(--teal-dark)", fontSize: 14 }}>就業判定の一括入力</strong>
          <p className="muted" style={{ margin: "4px 0 10px" }}>
            判定日は実行した当日が自動で記録されます。1名ずつは一覧の「就業判定」欄から選択できます。
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn" onClick={onNormalBulk} disabled={busy || normalTargets.length === 0}>
              A・B・Cの未判定 {normalTargets.length}名を「通常勤務可」で一括判定
            </button>
            {severeRows.length > 0 && (
              <button className="btn secondary" onClick={onSelectSevereUnjudged} disabled={busy}>
                Dの未判定を選択（{severeRows.filter((r) => !r.work_judgment).length}名）
              </button>
            )}
            {attentionRows.length > 0 && (
              <button className="btn secondary" onClick={onSelectAttention} disabled={busy}>
                要対応（未判定・判定保留）を選択（{attentionRows.length}名）
              </button>
            )}
          </div>

          {selected.size > 0 && (
            <div
              style={{
                marginTop: 12,
                paddingTop: 12,
                borderTop: "1px solid var(--teal)",
              }}
            >
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div>
                  <label className="muted" style={{ display: "block", fontSize: 12 }}>
                    選択中 {selected.size}名の就業判定
                  </label>
                  <select value={judgment} onChange={(e) => setJudgment(e.target.value)}>
                    {Object.entries(CHECKUP_WORK_JUDGMENTS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <label className="muted" style={{ display: "block", fontSize: 12 }}>
                    医師の意見（選択者に共通で入ります）
                  </label>
                  <div style={{ marginBottom: 4 }}>
                    {OPINION_PRESETS.map((p) =>
                      presetToggle(bulkPresets, setBulkPresets, p, "bulk")
                    )}
                  </div>
                  <input
                    type="text"
                    value={bulkFree}
                    onChange={(e) => setBulkFree(e.target.value)}
                    placeholder="自由記入（時間外労働の制限 など）"
                  />
                </div>
                <button className="btn orange" onClick={onSelectedBulk} disabled={busy}>
                  {busy ? "処理中…" : "選択者をまとめて判定"}
                </button>
              </div>
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

      <div style={{ overflowX: "auto" }}>
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
              <th style={{ minWidth: 130 }}>就業判定</th>
              <th style={{ minWidth: 200 }}>医師の意見</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const attention = needsAttention(c.work_judgment);
              const opinion = parseOpinionNote(c.work_judgment_note);
              return (
                <tr key={c.id} style={attention ? { background: "#fffaf5" } : {}}>
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
                  <td>
                    {canJudge ? (
                      <select
                        value={c.work_judgment ?? ""}
                        onChange={(e) => onRowJudgment(c.id, e.target.value)}
                        disabled={busy}
                        style={{ fontSize: 13, padding: "4px 6px", ...judgmentStyle(c.work_judgment) }}
                      >
                        <option value="" disabled>
                          未判定
                        </option>
                        {Object.entries(CHECKUP_WORK_JUDGMENTS).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span style={judgmentStyle(c.work_judgment)}>
                        {c.work_judgment ? CHECKUP_WORK_JUDGMENTS[c.work_judgment] : "未判定"}
                      </span>
                    )}
                    {c.work_judgment_date && (
                      <div className="muted" style={{ fontSize: 11 }}>
                        {formatDateJa(c.work_judgment_date)}
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: 13 }}>
                    {canJudge && editingNote === c.id ? (
                      <div>
                        <div style={{ marginBottom: 4 }}>
                          {OPINION_PRESETS.map((p) =>
                            presetToggle(
                              noteDraft.presets,
                              (list) => setNoteDraft((d) => ({ ...d, presets: list })),
                              p,
                              `row-${c.id}`
                            )
                          )}
                        </div>
                        <input
                          type="text"
                          value={noteDraft.freeText}
                          onChange={(e) =>
                            setNoteDraft((d) => ({ ...d, freeText: e.target.value }))
                          }
                          placeholder="自由記入"
                          style={{ fontSize: 13 }}
                        />
                        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                          <button
                            className="btn"
                            style={{ padding: "3px 10px", fontSize: 12 }}
                            onClick={() => saveNote(c.id)}
                            disabled={busy}
                          >
                            保存
                          </button>
                          <button
                            className="btn secondary"
                            style={{ padding: "3px 10px", fontSize: 12 }}
                            onClick={() => setEditingNote(null)}
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {opinion.presets.map((p) => (
                          <span key={p} className="badge orange" style={{ marginRight: 4 }}>
                            {p}
                          </span>
                        ))}
                        {opinion.freeText && <span>{opinion.freeText}</span>}
                        {!c.work_judgment_note && <span className="muted">—</span>}
                        {canJudge && (
                          <button
                            className="btn secondary"
                            style={{ padding: "2px 8px", fontSize: 11, marginLeft: 6 }}
                            onClick={() => startEditNote(c)}
                          >
                            編集
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
