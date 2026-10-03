"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { DOC_TYPES, REFERRAL_REQUEST_TEMPLATE } from "@/lib/karte";
import { currentUserId, logAccessInBackground } from "@/lib/session";
import { startNavigationProgress } from "@/lib/navigate";

export type DocumentInput = {
  id?: string;
  person_id: string;
  company_id: string;
  doc_type: string;
  title: string;
  addressee: string;
  body: string;
  issued_date: string;
  physician_name: string;
  visibility: string;
};

// 産業医の文書作成(officeのみ)。診療情報提供依頼書など
export default function DocumentForm({
  initial,
  backHref,
}: {
  initial: DocumentInput;
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
      // 診療情報提供依頼書に切り替えたとき、本文が空なら定型文を入れる
      body: t === "referral_request" && !p.body.trim() ? REFERRAL_REQUEST_TEMPLATE : p.body,
    }));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const userId = await currentUserId(supabase);

    const payload = {
      person_id: v.person_id,
      company_id: v.company_id,
      doc_type: v.doc_type,
      title: v.title.trim() || (DOC_TYPES[v.doc_type] ?? "文書"),
      addressee: v.addressee.trim() || null,
      body: v.body || null,
      issued_date: v.issued_date || null,
      physician_name: v.physician_name.trim() || null,
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
      logAccessInBackground(supabase, {
        p_action: "update",
        p_target_table: "hm_person_documents",
        p_target_id: id,
      });
    } else {
      const { data, error } = await supabase
        .from("hm_person_documents")
        .insert({ ...payload, created_by: userId })
        .select("id")
        .single();
      if (error || !data) {
        setError(`作成に失敗しました: ${error?.message ?? "unknown"}`);
        setBusy(false);
        return;
      }
      id = data.id;
      logAccessInBackground(supabase, {
        p_action: "create",
        p_target_table: "hm_person_documents",
        p_target_id: id ?? null,
      });
    }
    startNavigationProgress();
    // 動的ページはブラウザ側に保持しない設定(next.config)なので、移動だけで最新の内容が表示される
    router.replace(`/document/${id}`);
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
          {v.doc_type === "referral_request" && (
            <button
              type="button"
              className="btn secondary"
              style={{ padding: "2px 10px", fontSize: 12, marginLeft: 8 }}
              onClick={() => {
                if (v.body.trim() && v.body !== REFERRAL_REQUEST_TEMPLATE && !window.confirm("本文を定型文に置き換えます。よろしいですか？")) return;
                set("body", REFERRAL_REQUEST_TEMPLATE);
              }}
            >
              定型文に戻す
            </button>
          )}
          {v.doc_type === "referral_request" && (
            <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
              宛名の敬称「先生御侍史」、対象者の氏名・生年月日・所属、発行者、本人同意欄は印刷時に自動で付きます
            </span>
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
          <label>産業医名（敬称は付けません）</label>
          <input
            type="text"
            value={v.physician_name}
            onChange={(e) => set("physician_name", e.target.value)}
            placeholder="上松弘典"
            style={{ width: 200 }}
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
