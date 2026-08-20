"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { INTERVIEW_TYPES, INTERVIEW_METHODS } from "@/lib/interviews";

export type InterviewInput = {
  id?: string;
  company_id: string;
  person_id: string | null;
  target_user_id: string | null;
  target_name: string;
  birth_date: string; // カルテ未登録の対象者を新規作成する際に必須
  interview_type: string;
  scheduled_local: string; // datetime-local形式
  method: string;
  location: string;
};

type Person = {
  id: string;
  full_name: string;
  employee_no: string | null;
  user_id: string | null;
};

// mode: "office"=全項目 / "company"=日程調整のみ(日時・方法・場所)
export default function InterviewForm({
  initial,
  persons,
  backHref,
  mode,
}: {
  initial: InterviewInput;
  persons: Person[];
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
    if (mode === "office" && !v.person_id && !v.birth_date) {
      setError("カルテ未登録の方は生年月日を入力してください（カルテを自動作成します）。");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data: authUser } = await supabase.auth.getUser();

    const schedulePayload = {
      scheduled_at: v.scheduled_local ? new Date(v.scheduled_local).toISOString() : null,
      method: v.method || null,
      location: v.location || null,
    };

    // 氏名を直接入力した場合もカルテに反映する:
    // 同姓同名のカルテがあればそれに紐付け、なければ自動作成する
    let personId = v.person_id;
    if (mode === "office" && !personId && v.target_name.trim()) {
      const name = v.target_name.trim();
      const { data: existing } = await supabase
        .from("hm_persons")
        .select("id, user_id")
        .eq("company_id", v.company_id)
        .eq("full_name", name)
        .limit(1);
      if (existing && existing.length > 0) {
        personId = existing[0].id;
      } else {
        const { data: created, error: personErr } = await supabase
          .from("hm_persons")
          .insert({
            company_id: v.company_id,
            full_name: name,
            birth_date: v.birth_date || null,
            created_by: authUser.user?.id,
          })
          .select("id")
          .single();
        if (personErr || !created) {
          setError(`カルテの自動作成に失敗しました: ${personErr?.message ?? "unknown"}`);
          setBusy(false);
          return;
        }
        personId = created.id;
        await supabase.rpc("hm_log_access", {
          p_action: "create",
          p_target_table: "hm_persons",
          p_target_id: personId,
          p_detail: { auto_created_from: "interview" },
        });
      }
    }

    let id = v.id;
    if (id) {
      const payload =
        mode === "office"
          ? {
              ...schedulePayload,
              person_id: personId,
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
      const { data, error } = await supabase
        .from("hm_interviews")
        .insert({
          company_id: v.company_id,
          person_id: personId,
          target_user_id: v.target_user_id,
          target_name: v.target_name.trim(),
          interview_type: v.interview_type,
          ...schedulePayload,
          created_by: authUser.user?.id,
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
            <label>対象者（カルテから選択。面談がカルテの履歴に紐付きます）</label>
            <select
              value={v.person_id ?? ""}
              onChange={(e) => {
                const id = e.target.value || null;
                const person = persons.find((x) => x.id === id);
                setV((p) => ({
                  ...p,
                  person_id: id,
                  target_user_id: person?.user_id ?? null,
                  target_name: person?.full_name ?? p.target_name,
                }));
              }}
            >
              <option value="">（カルテ未登録 / 氏名を直接入力）</option>
              {persons.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.employee_no ? `${person.employee_no} ` : ""}
                  {person.full_name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label>対象者氏名 *</label>
              <input
                type="text"
                value={v.target_name}
                onChange={(e) => set("target_name", e.target.value)}
                placeholder="山田 太郎"
                required
              />
            </div>
            {!v.person_id && (
              <div>
                <label>生年月日 *</label>
                <input
                  type="date"
                  value={v.birth_date}
                  onChange={(e) => set("birth_date", e.target.value)}
                  required
                />
              </div>
            )}
          </div>
          {!v.person_id && (
            <p className="muted" style={{ margin: "-8px 0 14px" }}>
              カルテ未登録の方は、入力内容で個人カルテを自動作成します（生年月日は必須です）。
            </p>
          )}
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
