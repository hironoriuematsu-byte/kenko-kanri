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
  isRestrictionJudgment,
  isSevereJudgment,
  needsAttention,
  parseOpinionNote,
} from "@/lib/checkups";

export type FindingItem = { item_name: string; judgment: string | null; computed?: boolean };

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
  findingItems?: FindingItem[];
};

// 一覧の「就業判定」欄で未判定に戻すときの選択肢の値
const CLEAR = "__clear__";

// 有所見項目を C / D(過去データのEを含む) / R(就業制限の検討)に振り分ける
function splitFindings(items: FindingItem[]) {
  const c: FindingItem[] = [];
  const d: FindingItem[] = [];
  const r: FindingItem[] = [];
  for (const it of items) {
    if (isRestrictionJudgment(it.judgment)) r.push(it);
    else if (isSevereJudgment(it.judgment)) d.push(it);
    else c.push(it);
  }
  return { c, d, r };
}

// 項目名の並び
//   判定が C2 のように2文字以上のときは括弧で添える
//   事務所基準で補って判定した項目には * を付ける(欄外に注記)
function findingLabel(items: FindingItem[]) {
  return items
    .map((it) => {
      const j = (it.judgment ?? "").trim();
      const mark = it.computed ? "*" : "";
      return j.length > 1 ? `${it.item_name}(${j})${mark}` : `${it.item_name}${mark}`;
    })
    .join("、");
}

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

  // 就業制限の検討が必要な水準(R)の項目を持つ方
  const restrictionRows = useMemo(
    () => rows.filter((r) => (r.findingItems ?? []).some((it) => isRestrictionJudgment(it.judgment))),
    [rows]
  );
  const restrictionIds = useMemo(() => new Set(restrictionRows.map((r) => r.id)), [restrictionRows]);

  // 「通常勤務可」で一括判定してよい方(総合判定D以上とR該当は個別に判定する)
  const normalTargets = useMemo(
    () =>
      rows.filter(
        (r) =>
          !r.work_judgment && !isSevereJudgment(r.overall_judgment) && !restrictionIds.has(r.id)
      ),
    [rows, restrictionIds]
  );
  const severeRows = useMemo(
    () => rows.filter((r) => isSevereJudgment(r.overall_judgment)),
    [rows]
  );
  const attentionRows = useMemo(() => rows.filter((r) => needsAttention(r.work_judgment)), [rows]);
  const judgedRows = useMemo(() => rows.filter((r) => r.work_judgment), [rows]);
  // 判定区分ごとの該当者(区分ごとに一括で取り消せるようにする)
  const judgedByValue = useMemo(() => {
    const m = new Map<string, CheckupRow[]>();
    for (const r of judgedRows) {
      const key = r.work_judgment!;
      m.set(key, [...(m.get(key) ?? []), r]);
    }
    return m;
  }, [judgedRows]);
  const hasComputed = useMemo(
    () => rows.some((r) => (r.findingItems ?? []).some((it) => it.computed)),
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

  // 就業判定の取り消し(未判定に戻す)。判定日・医師の意見も一緒に消える
  const clearJudgment = async (ids: string[], label: string) => {
    const ok = window.confirm(
      `${label}の就業判定を取り消し、未判定の状態に戻します。\n` +
        `判定日と「医師の意見」も一緒に消えます。よろしいですか？`
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("hm_clear_work_judgment", { p_ids: ids });
    if (error) {
      setError(`判定の取り消しに失敗しました: ${error.message}`);
      setBusy(false);
      return;
    }
    setMessage(`${data}名の就業判定を取り消しました(未判定に戻りました)。`);
    setSelected(new Set());
    setBusy(false);
    router.refresh();
  };

  const onRowJudgment = async (id: string, value: string) => {
    if (value === CLEAR) {
      const target = rows.find((r) => r.id === id);
      await clearJudgment([id], target?.target_name ?? "この方");
      return;
    }
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
            就業制限項目（R）に該当する方は「通常勤務可」の一括判定の対象から外れます。
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn" onClick={onNormalBulk} disabled={busy || normalTargets.length === 0}>
              A・B・Cの未判定 {normalTargets.length}名を「通常勤務可」で一括判定
            </button>
            {restrictionRows.length > 0 && (
              // 判定済みでも選べるようにする(先に「通常勤務可」で一括判定した方を
              // あらためて就業制限に変更できるようにするため)
              <button
                className="btn secondary"
                onClick={() => setSelected(new Set(restrictionRows.map((r) => r.id)))}
                disabled={busy}
                style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
              >
                就業制限項目（R）を選択（{restrictionRows.length}名
                {restrictionRows.some((r) => !r.work_judgment)
                  ? `・うち未判定${restrictionRows.filter((r) => !r.work_judgment).length}名`
                  : ""}
                ）
              </button>
            )}
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

          {judgedRows.length > 0 && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--teal)" }}>
              <strong style={{ color: "var(--teal-dark)", fontSize: 13 }}>判定の取り消し</strong>
              <p className="muted" style={{ margin: "4px 0 8px" }}>
                判定区分ごとに、まとめて未判定に戻せます。判定日と「医師の意見」も一緒に消えます。
              </p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {Object.entries(CHECKUP_WORK_JUDGMENTS).map(([key, label]) => {
                  const targets = judgedByValue.get(key) ?? [];
                  if (targets.length === 0) return null;
                  return (
                    <button
                      key={key}
                      className="btn secondary"
                      onClick={() =>
                        clearJudgment(
                          targets.map((r) => r.id),
                          `「${label}」の ${targets.length}名`
                        )
                      }
                      disabled={busy}
                    >
                      「{label}」{targets.length}名を取り消す
                    </button>
                  );
                })}
                <button
                  className="btn secondary"
                  onClick={() =>
                    clearJudgment(judgedRows.map((r) => r.id), `判定済みの ${judgedRows.length}名すべて`)
                  }
                  disabled={busy}
                >
                  判定済み {judgedRows.length}名すべてを取り消す
                </button>
              </div>
            </div>
          )}

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
                <button
                  className="btn secondary"
                  onClick={() => clearJudgment(Array.from(selected), `選択した ${selected.size}名`)}
                  disabled={busy}
                >
                  判定を取り消す
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
              <th>有所見項目（C）</th>
              <th>有所見項目（D）</th>
              <th>就業制限項目（R）</th>
              <th style={{ minWidth: 130 }}>就業判定</th>
              <th style={{ minWidth: 200 }}>医師の意見</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const attention = needsAttention(c.work_judgment);
              const opinion = parseOpinionNote(c.work_judgment_note);
              const findings = splitFindings(c.findingItems ?? []);
              // 項目別の判定が取り込まれていない(総合判定のみの)記録
              const noItemFindings = findings.c.length === 0 && findings.d.length === 0 && c.has_findings;
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
                  {/* 有所見項目は C と D で列を分ける。項目別判定が無い記録は、
                      総合判定に合わせてどちらかの列に「有所見」と表示する */}
                  <td style={{ fontSize: 13 }}>
                    {findings.c.length > 0 ? (
                      findingLabel(findings.c)
                    ) : noItemFindings && !isSevereJudgment(c.overall_judgment) ? (
                      <span className="badge orange">有所見</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td style={{ fontSize: 13, color: findings.d.length > 0 ? "var(--danger)" : undefined }}>
                    {findings.d.length > 0 ? (
                      <strong>{findingLabel(findings.d)}</strong>
                    ) : noItemFindings && isSevereJudgment(c.overall_judgment) ? (
                      <span className="badge orange">有所見</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  {/* 就業制限の検討が必要な水準(R)。コンセンサス値を超えた項目 */}
                  <td style={{ fontSize: 13 }}>
                    {findings.r.length > 0 ? (
                      <strong style={{ color: "var(--danger)" }}>{findingLabel(findings.r)}</strong>
                    ) : (
                      <span className="muted">—</span>
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
                        {c.work_judgment && <option value={CLEAR}>― 判定を取り消す（未判定に戻す）</option>}
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

      {hasComputed && (
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          * 健診機関の項目別判定が入っていない項目について、事務所の判定基準で判定した結果です。
        </p>
      )}
    </div>
  );
}
