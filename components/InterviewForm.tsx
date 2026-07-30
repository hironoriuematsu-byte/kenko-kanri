"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { INTERVIEW_TYPES, INTERVIEW_METHODS } from "@/lib/interviews";

export type InterviewInput = {
  id?: string;
  company_id: string;
  target_user_id: string | null;
  target_name: string;
  interview_type: string;
  scheduled_local: string; // datetime-local形式
  method: string;
  location: string;
};

type Employee = { id: string; full_name: string | null };

// mode: "office"=全項目 / "company"=日程調整のみ(日時・方法・場所)
export default function InterviewForm({
  initial,
  employees,
  backHref,
  mode,
}: {
  initial: InterviewInput;
  employees: Employee[];
  backHref: string;
  mode: "office" | "company";
}) {
  const router = useRouter();
  const [v, setV] = useState<InterviewInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof InterviewInput>(k: K, val: InterviewInput[K]) =>
    setV((p) => ({ ...p, [k]: val }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!v.target_name.trim()) {
      setError("対象者氏名を入力してください。");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();

    const schedulePayload = {
      scheduled_at: v.scheduled_local ? new Date(v.scheduled_local).toISOString() : null,
      method: v.method || null,
      location: v.location || null,
    };

    let id = v.id;
    if (id) {
      const payload =
        mode === "office"
          ? {
              ...schedulePayload,
              target_user_id: v.target_user_id,
              target_name: v.target_name.trim(),
              interview_type: v.interview_type,
            }
          : schedulePayload;
      const { error } = await supabase.from("hm_interviews").update(payload).eq("id", id);
      if (error) {
        setError(`保存に失敗しました: ${error.message}`);
        setBusy(false);
        return;
      }
      await supabase.rpc("hm_log_access", {
        p_action: "update",
        p_target_table: "hm_interviews",
        p_target_id: id,
      });
    } else {
      const { data: user } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("hm_interviews")
        .insert({
          company_id: v.company_id,
          target_user_id: v.target_user_id,
          target_name: v.target_name.trim(),
          interview_type: v.interview_type,
          ...schedulePayload,
          created_by: user.user?.id,
        })
        .select("id")
        .single();
      if (error || !data) {
        setError(`登録に失敗しました: ${error?.message ?? "unknown"}`);
        setBusy(false);
        return;
      }
      id = data.id;
      await supabase.rpc("hm_log_access", {
        p_action: "create",
        p_target_table: "hm_interviews",
        p_target_id: id,
      });
    }
    router.replace(`/interviews/${id}`);
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit}>
      {mode === "office" && (
        <>
          <div className="form-row">
            <label>対象者（従業員アカウントから選択）</label>
            <select
              value={v.target_user_id ?? ""}
              onChange={(e) => {
                const id = e.target.value || null;
                const emp = employees.find((x) => x.id === id);
                setV((p) => ({
                  ...p,
                  target_user_id: id,
                  target_name: emp?.full_name ?? p.target_name,
                }));
              }}
            >
              <option value="">（選択しない / 氏名を直接入力）</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name ?? e.id}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>対象者氏名 *</label>
            <input
              type="text"
              value={v.target_name}
              onChange={(e) => set("target_name", e.target.value)}
              placeholder="山田 太郎"
              required
            />
          </div>
          <div className="form-row">
            <label>面談種別 *</label>
            <select
              value={v.interview_type}
              onChange={(e) => set("interview_type", e.target.value)}
            >
              {Object.entries(INTERVIEW_TYPES).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      <div className="form-row">
        <label>予定日時</label>
        <input
          type="datetime-local"
          value={v.scheduled_local}
          onChange={(e) => set("scheduled_local", e.target.value)}
        />
      </div>
      <div className="form-row">
        <label>実施方法</label>
        <select value={v.method} onChange={(e) => set("method", e.target.value)}>
          <option value="">未定</option>
          {Object.entries(INTERVIEW_METHODS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label>場所 / 接続先など</label>
        <input
          type="text"
          value={v.location}
          onChange={(e) => set("location", e.target.value)}
          placeholder="本社会議室A、Zoom URL など（健康情報は書かないでください）"
        />
      </div>

      {error && <p className="error-message">{error}</p>}

      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "保存中…" : "保存する"}
        </button>
        <button type="button" className="btn secondary" onClick={() => router.push(backHref)}>
          キャンセル
        </button>
      </div>
    </form>
  );
}
