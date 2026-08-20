"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import DateTextInput from "@/components/DateTextInput";

export type PersonInput = {
  id?: string;
  company_id: string;
  user_id: string | null;
  full_name: string;
  kana: string;
  employee_no: string;
  birth_date: string;
  department: string;
  note: string;
};

type Employee = { id: string; full_name: string | null };

export default function PersonForm({
  initial,
  employees,
  backHref,
}: {
  initial: PersonInput;
  employees: Employee[];
  backHref: string;
}) {
  const router = useRouter();
  const [v, setV] = useState<PersonInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof PersonInput>(k: K, val: PersonInput[K]) =>
    setV((p) => ({ ...p, [k]: val }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();

    // 同一企業に同姓同名の方がいる場合は、区別のため生年月日を必須にする
    if (!v.birth_date) {
      let dupQuery = supabase
        .from("hm_persons")
        .select("id")
        .eq("company_id", v.company_id)
        .eq("full_name", v.full_name.trim())
        .limit(1);
      if (v.id) dupQuery = dupQuery.neq("id", v.id);
      const { data: dup } = await dupQuery;
      if (dup && dup.length > 0) {
        setError(
          "同一企業に同姓同名の方が登録されています。区別のため生年月日を入力してください。"
        );
        setBusy(false);
        return;
      }
    }

    const payload = {
      company_id: v.company_id,
      user_id: v.user_id,
      full_name: v.full_name.trim(),
      kana: v.kana.trim() || null,
      employee_no: v.employee_no.trim() || null,
      birth_date: v.birth_date || null,
      department: v.department.trim() || null,
      note: v.note.trim() || null,
    };

    let id = v.id;
    if (id) {
      const { error } = await supabase.from("hm_persons").update(payload).eq("id", id);
      if (error) {
        setError(`保存に失敗しました: ${error.message}`);
        setBusy(false);
        return;
      }
      await supabase.rpc("hm_log_access", {
        p_action: "update",
        p_target_table: "hm_persons",
        p_target_id: id,
      });
    } else {
      const { data: user } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("hm_persons")
        .insert({ ...payload, created_by: user.user?.id })
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
        p_target_table: "hm_persons",
        p_target_id: id,
      });
    }
    router.replace(`/karte/${id}`);
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit}>
      <div className="form-row" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label>氏名 *</label>
          <input
            type="text"
            value={v.full_name}
            onChange={(e) => set("full_name", e.target.value)}
            required
          />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label>フリガナ</label>
          <input type="text" value={v.kana} onChange={(e) => set("kana", e.target.value)} />
        </div>
      </div>
      <div className="form-row" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div>
          <label>社員番号</label>
          <input
            type="text"
            value={v.employee_no}
            onChange={(e) => set("employee_no", e.target.value)}
            style={{ width: 140 }}
          />
        </div>
        <div>
          <label>生年月日</label>
          <DateTextInput
            value={v.birth_date}
            onChange={(val) => set("birth_date", val)}
          />
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label>部署</label>
          <input
            type="text"
            value={v.department}
            onChange={(e) => set("department", e.target.value)}
          />
        </div>
      </div>
      {employees.length > 0 && (
        <div className="form-row">
          <label>本人のログインアカウント（任意・紐付けると本人画面等と連動）</label>
          <select
            value={v.user_id ?? ""}
            onChange={(e) => set("user_id", e.target.value || null)}
          >
            <option value="">（紐付けない）</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.full_name ?? emp.id}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="form-row">
        <label>備考</label>
        <textarea
          value={v.note}
          onChange={(e) => set("note", e.target.value)}
          style={{ minHeight: 70 }}
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
