"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { currentUserId, logAccessInBackground } from "@/lib/session";
import { formatDateJa } from "@/lib/fiscal";
import {
  COMPLICATION_LABEL,
  DUST_STATUS_LABEL,
  EXAM_KIND_LABEL,
  KANRI_DETAILS_FOR,
  KANRI_DETAIL_LABEL,
  KANRI_LABEL,
  type ExamKind,
  type Kanri,
  type KanriDetail,
  type PneumoExam,
  type PneumoWorker,
} from "@/lib/pneumo";

type WorkerInput = Omit<PneumoWorker, "id" | "company_id" | "person_id">;
const EMPTY: WorkerInput = {
  full_name: "",
  dust_status: "current",
  dust_work_code: null,
  kanri: "1",
  kanri_detail: null,
  kanri_decided_on: null,
  kanri_previous: null,
  transferred_on: null,
  complication: null,
  complication_started_on: null,
  left_on: null,
  note: null,
};
const WORKER_COLS =
  "id, company_id, person_id, full_name, dust_status, dust_work_code, kanri, kanri_detail, kanri_decided_on, kanri_previous, transferred_on, complication, complication_started_on, left_on, note";
const EXAM_COLS = "id, worker_id, exam_date, exam_kind, lung_cancer, xray, note";

const opt = (v: string) => (v === "" ? null : v);

// じん肺健康管理台帳: 粉じん作業に従事している/従事したことのある在籍労働者と、じん肺健康診断の受診記録
export default function PneumoRegister({
  companyId,
  initialWorkers,
  initialExams,
}: {
  companyId: string;
  initialWorkers: PneumoWorker[];
  initialExams: PneumoExam[];
}) {
  const [workers, setWorkers] = useState<PneumoWorker[]>(initialWorkers);
  const [exams, setExams] = useState<PneumoExam[]>(initialExams);
  const [editing, setEditing] = useState<string | "new" | null>(initialWorkers.length === 0 ? "new" : null);
  const [openExams, setOpenExams] = useState<string | null>(null);
  const [showLeft, setShowLeft] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = workers.filter((w) => showLeft || !w.left_on);
  const latestExam = (id: string) => exams.filter((e) => e.worker_id === id).sort((a, b) => (a.exam_date < b.exam_date ? 1 : -1))[0];

  const saveWorker = async (input: WorkerInput, id: string | null) => {
    setError(null);
    const supabase = createClient();
    if (id) {
      const { data, error } = await supabase.from("hm_pneumo_workers").update(input).eq("id", id).select(WORKER_COLS).single();
      if (error || !data) return setError(`保存できませんでした: ${error?.message ?? "unknown"}`);
      setWorkers((p) => p.map((w) => (w.id === id ? (data as PneumoWorker) : w)));
      logAccessInBackground(supabase, { p_action: "update", p_target_table: "hm_pneumo_workers", p_target_id: id });
    } else {
      const created_by = await currentUserId(supabase);
      const { data, error } = await supabase
        .from("hm_pneumo_workers")
        .insert({ ...input, company_id: companyId, created_by })
        .select(WORKER_COLS)
        .single();
      if (error || !data) return setError(`登録できませんでした: ${error?.message ?? "unknown"}`);
      setWorkers((p) => [...p, data as PneumoWorker].sort((a, b) => a.full_name.localeCompare(b.full_name, "ja")));
      logAccessInBackground(supabase, { p_action: "create", p_target_table: "hm_pneumo_workers", p_target_id: (data as PneumoWorker).id });
    }
    setEditing(null);
  };

  const deleteWorker = async (w: PneumoWorker) => {
    if (!window.confirm(`「${w.full_name}」さんを台帳から削除します(健診の記録も消えます)。退職した方は、削除せずに退職日を入れてください。よろしいですか？`)) return;
    const supabase = createClient();
    const { error } = await supabase.from("hm_pneumo_workers").delete().eq("id", w.id);
    if (error) return setError(`削除できませんでした: ${error.message}`);
    setWorkers((p) => p.filter((x) => x.id !== w.id));
    setExams((p) => p.filter((x) => x.worker_id !== w.id));
    logAccessInBackground(supabase, { p_action: "delete", p_target_table: "hm_pneumo_workers", p_target_id: w.id, p_detail: { full_name: w.full_name } });
  };

  const addExam = async (workerId: string, e: Omit<PneumoExam, "id" | "worker_id">) => {
    setError(null);
    const supabase = createClient();
    const created_by = await currentUserId(supabase);
    const { data, error } = await supabase
      .from("hm_pneumo_exams")
      .insert({ ...e, worker_id: workerId, company_id: companyId, created_by })
      .select(EXAM_COLS)
      .single();
    if (error || !data) return setError(`健診の記録を保存できませんでした: ${error?.message ?? "unknown"}`);
    setExams((p) => [...p, data as PneumoExam]);
    logAccessInBackground(supabase, { p_action: "create", p_target_table: "hm_pneumo_exams", p_target_id: (data as PneumoExam).id });
  };

  const deleteExam = async (e: PneumoExam) => {
    if (!window.confirm(`${formatDateJa(e.exam_date)}(${EXAM_KIND_LABEL[e.exam_kind]})の健診の記録を削除します。よろしいですか？`)) return;
    const supabase = createClient();
    const { error } = await supabase.from("hm_pneumo_exams").delete().eq("id", e.id);
    if (error) return setError(`削除できませんでした: ${error.message}`);
    setExams((p) => p.filter((x) => x.id !== e.id));
    logAccessInBackground(supabase, { p_action: "delete", p_target_table: "hm_pneumo_exams", p_target_id: e.id });
  };

  return (
    <div>
      {error && <div className="error-message">{error}</div>}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <button className="btn" onClick={() => setEditing("new")} disabled={editing === "new"}>
          ＋ 人を追加
        </button>
        <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={showLeft} onChange={(e) => setShowLeft(e.target.checked)} /> 退職した人も表示
        </label>
      </div>

      {editing === "new" && <WorkerForm initial={EMPTY} onSave={(v) => saveWorker(v, null)} onCancel={() => setEditing(null)} />}

      {visible.length === 0 ? (
        <p className="muted">台帳に登録された人はいません。粉じん作業に従事している方と、過去に従事したことのある在籍者を登録してください。</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="list">
            <thead>
              <tr>
                <th>氏名</th>
                <th>粉じん作業</th>
                <th>作業コード</th>
                <th>管理区分</th>
                <th>最新のじん肺健診</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((w) => {
                const last = latestExam(w.id);
                return [
                  <tr key={w.id}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <strong>{w.full_name}</strong>
                      {w.left_on && <div className="muted" style={{ fontSize: 12 }}>退職 {formatDateJa(w.left_on)}</div>}
                    </td>
                    <td style={{ fontSize: 13 }}>
                      {w.dust_status === "current" ? "現在従事" : "過去に従事"}
                      {w.transferred_on && <div className="muted" style={{ fontSize: 12 }}>転換 {formatDateJa(w.transferred_on)}</div>}
                    </td>
                    <td>{w.dust_work_code ?? "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <span className={`badge${w.kanri === "1" ? "" : " orange"}`}>{KANRI_LABEL[w.kanri]}</span>
                      {w.kanri_detail && <div className="muted" style={{ fontSize: 12 }}>{w.kanri_detail === "other" ? "その他" : w.kanri_detail}</div>}
                      {w.complication && <div className="muted" style={{ fontSize: 12 }}>合併症 {COMPLICATION_LABEL[w.complication]}</div>}
                    </td>
                    <td style={{ whiteSpace: "nowrap", fontSize: 13 }}>
                      {last ? `${formatDateJa(last.exam_date)}(${EXAM_KIND_LABEL[last.exam_kind]})` : "—"}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button className="btn secondary" style={{ padding: "3px 10px", fontSize: 12 }} onClick={() => setOpenExams(openExams === w.id ? null : w.id)}>
                        健診の記録
                      </button>{" "}
                      <button className="btn secondary" style={{ padding: "3px 10px", fontSize: 12 }} onClick={() => setEditing(w.id)}>
                        編集
                      </button>{" "}
                      <button className="btn danger" style={{ padding: "3px 10px", fontSize: 12 }} onClick={() => deleteWorker(w)}>
                        削除
                      </button>
                    </td>
                  </tr>,
                  editing === w.id && (
                    <tr key={`${w.id}-edit`}>
                      <td colSpan={6}>
                        <WorkerForm initial={w} onSave={(v) => saveWorker(v, w.id)} onCancel={() => setEditing(null)} />
                      </td>
                    </tr>
                  ),
                  openExams === w.id && (
                    <tr key={`${w.id}-exams`}>
                      <td colSpan={6}>
                        <ExamList exams={exams.filter((e) => e.worker_id === w.id)} onAdd={(e) => addExam(w.id, e)} onDelete={deleteExam} />
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function WorkerForm({ initial, onSave, onCancel }: { initial: WorkerInput; onSave: (v: WorkerInput) => Promise<void>; onCancel: () => void }) {
  const [v, setV] = useState<WorkerInput>({ ...EMPTY, ...pickInput(initial) });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof WorkerInput>(k: K, val: WorkerInput[K]) => setV((p) => ({ ...p, [k]: val }));
  const details = KANRI_DETAILS_FOR[v.kanri] ?? [];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!v.full_name.trim()) return setErr("氏名を入力してください。");
    if (v.dust_work_code && !/^\d{3}$/.test(v.dust_work_code)) return setErr("粉じん作業コードは3桁の数字で入力してください(例: 202)。");
    if (v.complication && !v.complication_started_on) return setErr("合併症の療養を開始した日を入力してください。");
    setBusy(true);
    setErr(null);
    await onSave({
      ...v,
      full_name: v.full_name.trim(),
      kanri_detail: details.includes(v.kanri_detail as KanriDetail) ? v.kanri_detail : null,
      note: v.note?.trim() || null,
    });
    setBusy(false);
  };

  const row = { display: "flex", gap: 14, flexWrap: "wrap" as const };
  return (
    <form onSubmit={submit} style={{ background: "#FAFCFC", border: "1px solid var(--line)", borderRadius: 8, padding: 12, margin: "6px 0 12px" }}>
      <div style={row}>
        <div className="form-row" style={{ minWidth: 180 }}>
          <label>氏名 *</label>
          <input type="text" value={v.full_name} onChange={(e) => set("full_name", e.target.value)} required />
        </div>
        <div className="form-row">
          <label>粉じん作業(12月末現在)</label>
          <select value={v.dust_status} onChange={(e) => set("dust_status", e.target.value as WorkerInput["dust_status"])}>
            {Object.entries(DUST_STATUS_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="form-row" style={{ width: 150 }}>
          <label>粉じん作業コード(3桁)</label>
          <input type="text" value={v.dust_work_code ?? ""} inputMode="numeric" placeholder="例: 202" onChange={(e) => set("dust_work_code", opt(e.target.value.replace(/[^0-9]/g, "").slice(0, 3)))} />
        </div>
      </div>
      <div style={row}>
        <div className="form-row">
          <label>じん肺管理区分</label>
          <select value={v.kanri} onChange={(e) => set("kanri", e.target.value as Kanri)}>
            {Object.entries(KANRI_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
                {k === "1" ? "(所見なし)" : ""}
              </option>
            ))}
          </select>
        </div>
        {details.length > 0 && (
          <div className="form-row">
            <label>{KANRI_LABEL[v.kanri]}の内訳</label>
            <select value={v.kanri_detail ?? ""} onChange={(e) => set("kanri_detail", opt(e.target.value) as KanriDetail | null)}>
              <option value="">選んでください</option>
              {details.map((d) => (
                <option key={d} value={d}>
                  {KANRI_DETAIL_LABEL[d]}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="form-row">
          <label>決定日(労働局長の通知)</label>
          <input type="date" value={v.kanri_decided_on ?? ""} onChange={(e) => set("kanri_decided_on", opt(e.target.value))} />
        </div>
        <div className="form-row">
          <label>決定前の管理区分</label>
          <select value={v.kanri_previous ?? ""} onChange={(e) => set("kanri_previous", opt(e.target.value) as Kanri | null)}>
            <option value="">—</option>
            {Object.entries(KANRI_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div style={row}>
        <div className="form-row">
          <label>粉じん作業から他の作業へ転換した日</label>
          <input type="date" value={v.transferred_on ?? ""} onChange={(e) => set("transferred_on", opt(e.target.value))} />
        </div>
        <div className="form-row">
          <label>合併症(療養中)</label>
          <select value={v.complication ?? ""} onChange={(e) => set("complication", e.target.value ? Number(e.target.value) : null)}>
            <option value="">なし</option>
            {Object.entries(COMPLICATION_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        {v.complication && (
          <div className="form-row">
            <label>療養を開始した日</label>
            <input type="date" value={v.complication_started_on ?? ""} onChange={(e) => set("complication_started_on", opt(e.target.value))} />
          </div>
        )}
        <div className="form-row">
          <label>退職日</label>
          <input type="date" value={v.left_on ?? ""} onChange={(e) => set("left_on", opt(e.target.value))} />
        </div>
      </div>
      <div className="form-row">
        <label>備考</label>
        <input type="text" value={v.note ?? ""} onChange={(e) => set("note", e.target.value)} />
      </div>
      <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
        管理区分は、じん肺健康診断で所見があった方について労働局長から届く「じん肺管理区分決定通知書」で確認できます。粉じん作業から他の作業へ転換したときは、「粉じん作業」を「過去に従事」に変え、転換した日を入れてください。
      </p>
      {err && <div className="error-message">{err}</div>}
      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "保存しています…" : "保存"}
        </button>
        <button className="btn secondary" type="button" onClick={onCancel} disabled={busy}>
          やめる
        </button>
      </div>
    </form>
  );
}

function pickInput(w: WorkerInput): WorkerInput {
  const out = { ...EMPTY };
  (Object.keys(EMPTY) as (keyof WorkerInput)[]).forEach((k) => {
    (out as Record<string, unknown>)[k] = (w as Record<string, unknown>)[k] ?? (EMPTY as Record<string, unknown>)[k];
  });
  return out;
}

function ExamList({
  exams,
  onAdd,
  onDelete,
}: {
  exams: PneumoExam[];
  onAdd: (e: Omit<PneumoExam, "id" | "worker_id">) => Promise<void>;
  onDelete: (e: PneumoExam) => void;
}) {
  const [date, setDate] = useState("");
  const [kind, setKind] = useState<ExamKind>("periodic");
  const [lungCancer, setLungCancer] = useState(false);
  const [xray, setXray] = useState("");
  const [busy, setBusy] = useState(false);
  const sorted = [...exams].sort((a, b) => (a.exam_date < b.exam_date ? 1 : -1));

  const add = async () => {
    if (!date) return;
    setBusy(true);
    await onAdd({ exam_date: date, exam_kind: kind, lung_cancer: kind === "extra" && lungCancer, xray: xray.trim() || null, note: null });
    setBusy(false);
    setDate("");
    setXray("");
    setLungCancer(false);
  };

  return (
    <div style={{ background: "#FAFCFC", border: "1px solid var(--line)", borderRadius: 8, padding: 12 }}>
      <strong style={{ fontSize: 14 }}>じん肺健康診断の受診記録</strong>
      {sorted.length === 0 ? (
        <p className="muted" style={{ margin: "6px 0" }}>まだ記録はありません。</p>
      ) : (
        <ul style={{ margin: "6px 0 10px", paddingLeft: 20, fontSize: 13.5, lineHeight: 1.9 }}>
          {sorted.map((e) => (
            <li key={e.id}>
              {formatDateJa(e.exam_date)} {EXAM_KIND_LABEL[e.exam_kind]}
              {e.lung_cancer && "(肺がんに関する検査あり)"}
              {e.xray && ` / エックス線の像 ${e.xray}`}{" "}
              <button onClick={() => onDelete(e)} style={{ background: "none", border: 0, color: "#B02A2A", cursor: "pointer", fontSize: 12 }}>
                削除
              </button>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label>健診日</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label>区分</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as ExamKind)}>
            {Object.entries(EXAM_KIND_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        {kind === "extra" && (
          <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center", paddingBottom: 8 }}>
            <input type="checkbox" checked={lungCancer} onChange={(e) => setLungCancer(e.target.checked)} /> 肺がんに関する検査を行った
          </label>
        )}
        <div className="form-row" style={{ marginBottom: 0, width: 140 }}>
          <label>エックス線の像(任意)</label>
          <input type="text" value={xray} placeholder="例: 0/0" onChange={(e) => setXray(e.target.value.slice(0, 20))} style={{ width: "100%", boxSizing: "border-box" }} />
        </div>
        <button className="btn" type="button" onClick={add} disabled={busy || !date}>
          {busy ? "追加しています…" : "記録を追加"}
        </button>
      </div>
    </div>
  );
}
