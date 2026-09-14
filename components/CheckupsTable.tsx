"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { formatDateJa } from "@/lib/fiscal";
import { referralNote } from "@/lib/referral";
import {
  CHECKUP_TYPES,
  CHECKUP_WORK_JUDGMENTS,
  FOLLOWUP_STATUS,
  OPINION_PRESETS,
  WORK_JUDGMENT_CONDITIONS,
  buildOpinionNote,
  conditionLabel,
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
  sex?: string | null; // 受診勧奨の文章(貧血の受診先)に使う
  checkup_type: string;
  checkup_date: string | null;
  overall_judgment: string | null;
  has_findings: boolean;
  work_judgment: string | null;
  work_judgment_note: string | null;
  work_judgment_date: string | null;
  work_judgment_condition?: string | null; // 判定条件(consult = 受診が条件)
  followup_status?: string | null; // 受診勧奨の状態(none/pending/recommended/done)
  special_kind?: string | null; // 特殊健診の種類(有機溶剤・鉛 など)
  findingItems?: FindingItem[];
};

// 一覧の「就業判定」欄で未判定に戻すときの選択肢の値
const CLEAR = "__clear__";

// 「要就業制限」で一括判定するときの初期値(定型文のチェック)
const RESTRICTED_DEFAULT_PRESETS = ["要産業医面談", "時間外労働月45時間以内"];
// 「要医療項目（D）の未判定を選択」から「通常勤務可」で一括判定するときの定型文の初期値
// (「受診が条件」は医師の意見ではなく判定条件として付ける)
const SEVERE_DEFAULT_PRESETS: string[] = [];

// 一括判定のとき、従業員ごとに「医師の意見」の先頭に入れる文章は lib/referral.ts の
// referralNote で作る(例: 「肝機能異常あり内科（消化器内科）受診」)

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

// 健診日を「2025年」「10月17日」の2行で表示する(1列に収める)
function dateLines(dateStr: string | null | undefined): [string, string] | null {
  if (!dateStr) return null;
  const d = new Date(dateStr + (dateStr.length === 10 ? "T00:00:00" : ""));
  if (isNaN(d.getTime())) return [dateStr, ""];
  return [`${d.getFullYear()}年`, `${d.getMonth() + 1}月${d.getDate()}日`];
}

// 一覧の絞り込み(有所見D・就業制限Rの方だけを確認できるようにする)
type ViewFilter = "all" | "d" | "r" | "dr";
const VIEW_LABEL: Record<ViewFilter, string> = {
  all: "すべて",
  d: "要医療項目（D）あり",
  r: "就業制限項目（R）あり",
  dr: "DまたはRあり",
};

const nowrap: React.CSSProperties = { whiteSpace: "nowrap" };

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
  canFollowup = false,
}: {
  rows: CheckupRow[];
  canDelete: boolean;
  canJudge?: boolean;
  canFollowup?: boolean; // 受診勧奨の状態を変更できるか(実施者・企業担当者)
}) {
  const router = useRouter();

  // 受診勧奨の状態(受診勧奨 → 勧奨済 → 受診済)を変更する
  const setFollowup = async (id: string, status: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("hm_set_followup", { p_id: id, p_status: status, p_note: null });
    if (error) setError(`受診勧奨の状態を変更できませんでした: ${error.message}`);
    else router.refresh();
    setBusy(false);
  };
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [judgment, setJudgment] = useState("restricted");
  // 一括判定の初期の区分は「要就業制限」なので、定型文もその初期値にしておく。
  // 自由記入は空(従業員ごとの「○○につき医療機関受診」は自動で先頭に入る)
  const [bulkPresets, setBulkPresets] = useState<string[]>(RESTRICTED_DEFAULT_PRESETS);
  const [bulkFree, setBulkFree] = useState("");
  // 判定条件「受診が条件」: 通常勤務可で一括判定するとき、要医療項目(D)・就業制限項目(R)の
  // ある方に付ける(初期はオン)
  const [bulkConsult, setBulkConsult] = useState(true);

  const samePresets = (a: string[], b: string[]) =>
    a.length === b.length && a.every((p) => b.includes(p));

  // 判定区分を切り替えたとき、定型文が初期値のまま(または未チェック)なら区分に合わせて
  // 入れ替える。手で変えた内容はそのまま残す
  const changeJudgment = (value: string) => {
    setJudgment(value);
    const presetsUntouched =
      bulkPresets.length === 0 ||
      samePresets(bulkPresets, RESTRICTED_DEFAULT_PRESETS) ||
      samePresets(bulkPresets, SEVERE_DEFAULT_PRESETS);
    if (presetsUntouched) setBulkPresets(value === "restricted" ? RESTRICTED_DEFAULT_PRESETS : []);
  };
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

  // 要医療項目(D)を持つ方。項目別判定が無い記録は総合判定がD以上なら該当とする
  const dRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          isSevereJudgment(r.overall_judgment) ||
          (r.findingItems ?? []).some(
            (it) => isSevereJudgment(it.judgment) && !isRestrictionJudgment(it.judgment)
          )
      ),
    [rows]
  );
  const dIds = useMemo(() => new Set(dRows.map((r) => r.id)), [dRows]);

  // 一覧の絞り込み(有所見D・就業制限Rの方を特に注意して確認できるようにする)
  const [view, setView] = useState<ViewFilter>("all");
  const visibleRows = useMemo(() => {
    if (view === "d") return rows.filter((r) => dIds.has(r.id));
    if (view === "r") return rows.filter((r) => restrictionIds.has(r.id));
    if (view === "dr") return rows.filter((r) => dIds.has(r.id) || restrictionIds.has(r.id));
    return rows;
  }, [rows, view, dIds, restrictionIds]);
  const viewCounts: Record<ViewFilter, number> = {
    all: rows.length,
    d: dRows.length,
    r: restrictionRows.length,
    dr: rows.filter((r) => dIds.has(r.id) || restrictionIds.has(r.id)).length,
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // 全選択は、絞り込んで表示中の方だけを対象にする
  const toggleAll = () =>
    setSelected((prev) => {
      const ids = visibleRows.map((r) => r.id);
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id));
      return allSelected ? new Set() : new Set(ids);
    });

  // 一括判定。notes を渡すと従業員ごとに異なる「医師の意見」を、conditionIds を渡すと
  // 「受診が条件」の判定条件を保存する(0132)。
  // まだ0132が適用されていない環境では、1人ずつ保存する方法に切り替える(判定条件は保存されない)
  const runBulkJudgment = async (
    ids: string[],
    value: string,
    note: string | null,
    notes?: Record<string, string>,
    conditionIds?: string[] | null
  ) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const supabase = createClient();
    const res = notes
      ? await supabase.rpc("hm_bulk_work_judgment", {
          p_ids: ids,
          p_judgment: value,
          p_note: note,
          p_notes: notes,
          p_condition_ids: conditionIds ?? null,
        })
      : await supabase.rpc("hm_bulk_work_judgment", {
          p_ids: ids,
          p_judgment: value,
          p_note: note,
        });
    let data: number = Number(res.data ?? 0);
    let errMsg: string | null = res.error?.message ?? null;
    let fallbackNote = "";
    if (errMsg && notes && /hm_bulk_work_judgment|p_notes|p_condition_ids/.test(errMsg)) {
      // 5引数の版が無い(0132未適用)ときは1人ずつ保存する
      let saved = 0;
      let firstError: string | null = null;
      for (const id of ids) {
        const { error: e } = await supabase.rpc("hm_save_work_judgment", {
          p_id: id,
          p_judgment: value,
          p_note: notes[id] ?? note,
          p_date: null,
        });
        if (e) {
          firstError = firstError ?? e.message;
          continue;
        }
        saved++;
      }
      data = saved;
      errMsg = saved === 0 ? firstError : null;
      if ((conditionIds ?? []).length > 0) {
        fallbackNote = "（判定条件「受診が条件」はデータベースの更新(0132)を実行した後に保存できます）";
      }
    }
    if (errMsg) {
      setError(`一括判定に失敗しました: ${errMsg}`);
      setBusy(false);
      return;
    }
    if (Number(data ?? 0) === 0) {
      setError("対象が0名でした。判定は変更されていません。");
      setBusy(false);
      return;
    }
    setMessage(
      `${data}名の就業判定を「${CHECKUP_WORK_JUDGMENTS[value]}」で登録しました（判定日は本日）。${fallbackNote}`
    );
    setSelected(new Set());
    setBulkPresets(judgment === "restricted" ? RESTRICTED_DEFAULT_PRESETS : []);
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
    if (selected.size === 0) {
      setError("対象が選択されていません。一覧のチェックボックス、または上の選択ボタンで対象を選んでください。");
      return;
    }
    const common = buildOpinionNote(bulkPresets, bulkFree);
    // 従業員ごとに「○○につき医療機関受診」を先頭に付けた医師の意見を作る
    const ids = Array.from(selected);
    const notes: Record<string, string> = {};
    const referralIds: string[] = [];
    for (const id of ids) {
      const row = rows.find((r) => r.id === id);
      const sex = row?.sex === "male" || row?.sex === "female" ? row.sex : null;
      const referral = referralNote(row?.findingItems ?? [], sex);
      if (referral) referralIds.push(id);
      notes[id] = [referral, common].filter(Boolean).join(" / ");
    }
    // 判定条件「受診が条件」: 通常勤務可のとき、D・Rのある方に付ける(チェックを外せば付けない)
    const conditionIds = judgment === "normal" ? (bulkConsult ? referralIds : []) : null;
    const ok = window.confirm(
      `選択した ${selected.size}名を「${CHECKUP_WORK_JUDGMENTS[judgment]}」で判定します。\n` +
        (referralIds.length > 0
          ? `医師の意見: 要医療項目（D）・就業制限項目（R）のある ${referralIds.length}名には、「肝機能異常あり内科（消化器内科）受診」のような受診勧奨の文章が入ります。\n`
          : "") +
        (conditionIds && conditionIds.length > 0
          ? `判定条件: その ${conditionIds.length}名は「受診が条件」の条件付きの通常勤務可になります。\n`
          : "") +
        (common ? `共通の意見: ${common}\n` : "") +
        `判定日は本日として記録されます。よろしいですか？`
    );
    if (!ok) return;
    await runBulkJudgment(ids, judgment, common || null, notes, conditionIds);
  };

  // 一覧の1人分の判定条件「受診が条件」を付け外しする(通常勤務可の方のみ)
  const setCondition = async (id: string, on: boolean) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("hm_set_work_judgment_condition", {
      p_ids: [id],
      p_on: on,
    });
    if (error) {
      setError(
        `判定条件を変更できませんでした: ${error.message}（データベースの更新(0132)が未適用の可能性があります）`
      );
    } else router.refresh();
    setBusy(false);
  };

  // 「Dの未判定を選択」: 通常勤務可(医療機関受診を条件)で判定する前提で初期値を入れる
  const onSelectSevereUnjudged = () => {
    setSelected(new Set(severeRows.filter((r) => !r.work_judgment).map((r) => r.id)));
    setJudgment("normal");
    setBulkPresets(SEVERE_DEFAULT_PRESETS);
  };

  // 「就業制限項目（R）を選択」: 要就業制限(但し受診が条件・要産業医面談)で判定する前提で初期値を入れる
  const onSelectRestriction = () => {
    setSelected(new Set(restrictionRows.map((r) => r.id)));
    setJudgment("restricted");
    setBulkPresets(RESTRICTED_DEFAULT_PRESETS);
  };

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
          <div style={{ marginBottom: 10 }}>
            <button className="btn" onClick={onNormalBulk} disabled={busy || normalTargets.length === 0}>
              A・B・Cの未判定 {normalTargets.length}名を「通常勤務可」で一括判定
            </button>
          </div>
          {/* 左: 要医療項目(D)の選択、右: 就業制限項目(R)の選択 */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {severeRows.length > 0 && (
              <button className="btn secondary" onClick={onSelectSevereUnjudged} disabled={busy}>
                要医療項目（D）の未判定を選択（{severeRows.filter((r) => !r.work_judgment).length}名）
              </button>
            )}
            {restrictionRows.length > 0 && (
              <button className="btn secondary" onClick={onSelectRestriction} disabled={busy}>
                就業制限項目（R）を選択（{restrictionRows.length}名）
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
                  <select value={judgment} onChange={(e) => changeJudgment(e.target.value)}>
                    {Object.entries(CHECKUP_WORK_JUDGMENTS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                {judgment === "normal" && (
                  <div>
                    <label className="muted" style={{ display: "block", fontSize: 12 }}>
                      判定条件
                    </label>
                    <label
                      htmlFor="bulk-consult"
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, padding: "6px 0" }}
                    >
                      <input
                        id="bulk-consult"
                        type="checkbox"
                        checked={bulkConsult}
                        onChange={(e) => setBulkConsult(e.target.checked)}
                        style={{ width: 15, height: 15 }}
                      />
                      {WORK_JUDGMENT_CONDITIONS.consult}（D・Rのある方に付けます）
                    </label>
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 220 }}>
                  <label className="muted" style={{ display: "block", fontSize: 12 }}>
                    医師の意見（選択者に共通で入ります）。要医療項目（D）・就業制限項目（R）のある方には、
                    「肝機能異常あり内科（消化器内科）受診」のような受診勧奨の文章が自動で先頭に入ります
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

      {/* 表示の絞り込み: 有所見(D)・就業制限(R)の方だけを確認できるようにする */}
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
          margin: "8px 0",
        }}
      >
        <span className="muted" style={{ fontSize: 13 }}>表示:</span>
        {(Object.keys(VIEW_LABEL) as ViewFilter[]).map((k) => {
          const active = view === k;
          const danger = k !== "all";
          return (
            <button
              key={k}
              className={active ? (danger ? "btn orange" : "btn") : "btn secondary"}
              style={{ padding: "4px 12px", fontSize: 13 }}
              onClick={() => setView(k)}
              aria-pressed={active}
            >
              {VIEW_LABEL[k]}（{viewCounts[k]}名）
            </button>
          );
        })}
        {view !== "all" && (
          <span className="muted" style={{ fontSize: 12 }}>
            {VIEW_LABEL[view]}の {visibleRows.length}名を表示中。上の一括判定は絞り込みに関係なく全員が対象です。
          </span>
        )}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="list">
          <thead>
            <tr>
              {showCheckbox && (
                <th style={{ width: 34 }}>
                  <input
                    type="checkbox"
                    checked={
                      visibleRows.length > 0 && visibleRows.every((r) => selected.has(r.id))
                    }
                    onChange={toggleAll}
                    aria-label="全選択"
                  />
                </th>
              )}
              <th style={nowrap}>
                社員
                <br />
                番号
              </th>
              <th style={nowrap}>氏名</th>
              <th style={nowrap}>種別</th>
              <th style={nowrap}>健診日</th>
              <th style={nowrap}>
                総合
                <br />
                判定
              </th>
              {/* 有所見(C)(D)・就業制限(R)は3行の見出しで高さをそろえる */}
              <th style={nowrap}>
                有所見
                <br />
                項目
                <br />
                （C）
              </th>
              <th style={nowrap}>
                要医療
                <br />
                項目
                <br />
                （D）
              </th>
              <th style={nowrap}>
                就業制限
                <br />
                項目
                <br />
                （R）
              </th>
              <th style={{ minWidth: 130, ...nowrap }}>就業判定</th>
              <th style={{ minWidth: 200, ...nowrap }}>医師の意見</th>
              <th style={{ minWidth: 110, ...nowrap }}>受診勧奨</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={showCheckbox ? 12 : 11} className="muted" style={{ textAlign: "center" }}>
                  {view === "all" ? "健診記録がありません。" : `${VIEW_LABEL[view]}の方はいません。`}
                </td>
              </tr>
            )}
            {visibleRows.map((c) => {
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
                  <td style={nowrap}>{c.employee_no || "—"}</td>
                  <td style={nowrap}>
                    <Link href={`/checkup/${c.id}`}>{c.target_name}</Link>
                  </td>
                  <td style={nowrap}>
                    {CHECKUP_TYPES[c.checkup_type] ?? c.checkup_type}
                    {c.special_kind && (
                      <div className="muted" style={{ fontSize: 11 }}>
                        {c.special_kind}
                      </div>
                    )}
                  </td>
                  {/* 健診日は「2025年」「10月17日」の2行で1列に収める */}
                  <td style={nowrap}>
                    {(() => {
                      const lines = dateLines(c.checkup_date);
                      if (!lines) return "—";
                      return (
                        <>
                          <div>{lines[0]}</div>
                          {lines[1] && <div>{lines[1]}</div>}
                        </>
                      );
                    })()}
                  </td>
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
                    {/* 判定条件「受診が条件」(通常勤務可のときだけ) */}
                    {c.work_judgment === "normal" &&
                      (canJudge ? (
                        <label
                          htmlFor={`consult-${c.id}`}
                          style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, marginTop: 4 }}
                        >
                          <input
                            id={`consult-${c.id}`}
                            type="checkbox"
                            checked={c.work_judgment_condition === "consult"}
                            onChange={(e) => setCondition(c.id, e.target.checked)}
                            disabled={busy}
                            style={{ width: 14, height: 14 }}
                          />
                          {WORK_JUDGMENT_CONDITIONS.consult}
                        </label>
                      ) : (
                        c.work_judgment_condition && (
                          <div>
                            <span className="badge orange">{conditionLabel(c.work_judgment_condition)}</span>
                          </div>
                        )
                      ))}
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
                  {/* 受診勧奨のフォローアップ。総合判定D以上は取込時に「受診勧奨」になる */}
                  <td>
                    {canFollowup ? (
                      <select
                        value={c.followup_status ?? "none"}
                        onChange={(e) => setFollowup(c.id, e.target.value)}
                        disabled={busy}
                        style={{
                          fontSize: 13,
                          padding: "4px 6px",
                          ...(c.followup_status === "pending"
                            ? { color: "var(--orange)", fontWeight: 700 }
                            : {}),
                        }}
                      >
                        {Object.entries(FOLLOWUP_STATUS).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span style={c.followup_status === "pending" ? { color: "var(--orange)", fontWeight: 700 } : {}}>
                        {FOLLOWUP_STATUS[c.followup_status ?? "none"] ?? "—"}
                      </span>
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
