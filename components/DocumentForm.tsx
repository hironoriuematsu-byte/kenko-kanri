"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { DOC_TYPES, REFERRAL_REQUEST_TEMPLATE } from "@/lib/karte";

export type DocumentInput = {
  id?: string;
  person_id: string;
  company_id: string;
  doc_type: string;
  title: string;
  addressee: string;
  body: string;
  issued_date: string;
  visibility: string;
};

// 産業医の文書作成(officeのみ)。診療情報提供依頼書など
export default function DocumentForm({
  initial,
  physicianName,
  backHref,
}: {
  initial: DocumentInput;
  physicianName: string;
  backHref: string;
}) {
  const router = useRouter();
  const [v, setV] = useState<DocumentInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof DocumentInput>(k: K, val: DocumentInput[K]) =>
    setV((p) => ({ ...p, [k]: val }));

  const onTypeChange = (t: string) => {
    setV((p) => ({
      ...p,
      doc_type: t,
      title:
        !p.title || Object.values(DOC_TYPES).includes(p.title)
          ? (DOC_TYPES[t] ?? p.title)
          : p.title,
    }));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data: user } = await supabase.auth.getUser();

    const payload = {
      person_id: v.person_id,
      company_id: v.company_id,
      doc_type: v.doc_type,
      title: v.title.trim() || (DOC_TYPES[v.doc_type] ?? "文書"),
      addressee: v.addressee.trim() || null,
      body: v.body || null,
      issued_date: v.issued_date || null,
      physician_name: physicianName,
      visibility: v.visibility,
    };

    let id = v.id;
    if (id) {
      const { error } = await supabase
        .from("hm_person_documents")
        .update(payload)
        .eq("id", id);
      if (error) {
        setError(`保存に失敗しました: ${error.message}`);
        setBusy(false);
        return;
      }
      await supabase.rpc("hm_log_access", {
        p_action: "update",
        p_target_table: "hm_person_documents",
        p_target_id: id,
      });
    } else {
      const { data, error } = await supabase
        .from("hm_person_documents")
        .insert({ ...payload, created_by: user.user?.id })
        .select("id")
        .single();
      if (error || !data) {
        setError(`作成に失敗しました: ${error?.message ?? "unknown"}`);
        setBusy(false);
        return;
      }
      id = data.id;
      await supabase.rpc("hm_log_access", {
        p_action: "create",
        p_target_table: "hm_person_documents",
        p_target_id: id,
      });
    }
    router.replace(`/document/${id}`);
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit}>
      <div className="form-row" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div>
          <label>文書の種類</label>
          <select value={v.doc_type} onChange={(e) => onTypeChange(e.target.value)}>
            {Object.entries(DOC_TYPES).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label>表題</label>
          <input type="text" value={v.title} onChange={(e) => set("title", e.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <label>宛先（医療機関名・診療科・医師名）</label>
        <input
          type="text"
          value={v.addressee}
          onChange={(e) => set("addressee", e.target.value)}
          placeholder="○○病院 内科 ○○先生"
        />
      </div>
      <div className="form-row">
        <label>
          本文{" "}
          {v.doc_type === "referral_request" && !v.body && (
            <button
              type="button"
              className="btn secondary"
              style={{ padding: "2px 10px", fontSize: 12, marginLeft: 8 }}
              onClick={() => set("body", REFERRAL_REQUEST_TEMPLATE)}
            >
              定型文を挿入
            </button>
          )}
        </label>
        <textarea
          value={v.body}
          onChange={(e) => set("body", e.target.value)}
          style={{ minHeight: 220 }}
        />
      </div>
      <div className="form-row" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div>
          <label>発行日</label>
          <input
            type="date"
            value={v.issued_date}
            onChange={(e) => set("issued_date", e.target.value)}
          />
        </div>
        <div>
          <label>公開範囲</label>
          <select value={v.visibility} onChange={(e) => set("visibility", e.target.value)}>
            <option value="office_only">産業医事務所のみ</option>
            <option value="shared">企業と共有</option>
          </select>
        </div>
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
