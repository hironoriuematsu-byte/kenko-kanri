"use client";

import { FormEvent, useMemo, useState } from "react";
import { startNavigationProgress } from "@/lib/navigate";
import { currentUserId, logAccessInBackground } from "@/lib/session";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { INTERVIEW_TYPES, INTERVIEW_METHODS } from "@/lib/interviews";
import DateTextInput from "@/components/DateTextInput";
import { BIRTH_DATE_LABEL, BIRTH_DATE_REQUIRED } from "@/lib/personPolicy";

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
  // ストレスチェックWebの面接指導の申出から登録された面談(その申出のID)
  interview_request_id?: string | null;
  // 本人から面接指導の申出があった(会社への結果の提供に同意している)ことを、産業医事務所が確かめた印(0159)
  request_confirmed?: boolean;
};

type Person = {
  id: string;
  full_name: string;
  kana?: string | null;
  employee_no: string | null;
  department?: string | null;
  user_id: string | null;
};

// 検索用の正規化: 空白除去・小文字化・ひらがな→カタカナ
function normalizeSearch(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[\s　]/g, "")
    .toLowerCase()
    .replace(/[ぁ-ん]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}

// mode: "office"=全項目 / "company"=日程調整のみ(日時・方法・場所)
export default function InterviewForm({
  initial,
  persons,
  backHref,
  mode,
  confirmReady = false,
}: {
  initial: InterviewInput;
  persons: Person[];
  backHref: string;
  mode: "office" | "company";
  confirmReady?: boolean; // 申出の確認の印が使えるか(SQL 0159 の実行後)
}) {
  const router = useRouter();
  const [v, setV] = useState<InterviewInput>(initial);
  const [personQuery, setPersonQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 社員番号・氏名・フリガナ・部署で対象者を絞り込む
  const filteredPersons = useMemo(() => {
    const q = normalizeSearch(personQuery);
    if (!q) return persons;
    return persons.filter((p) =>
      [p.employee_no, p.full_name, p.kana, p.department]
        .filter(Boolean)
        .some((field) => normalizeSearch(field as string).includes(q))
    );
  }, [persons, personQuery]);

  const set = <K extends keyof InterviewInput>(k: K, val: InterviewInput[K]) =>
    setV((p) => ({ ...p, [k]: val }));

  // 手で登録する高ストレス面接指導(ストレスチェックWebの申出から登録されたものではない)は、申出の確認が要る
  const needsConfirm = v.interview_type === "high_stress" && !v.interview_request_id;
  // 保存する申出の確認の印(SQL 0159 の実行前は送らない)
  const confirmPayload = confirmReady ? { request_confirmed: needsConfirm && Boolean(v.request_confirmed) } : {};

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!v.target_name.trim()) {
      setError("対象者氏名を入力してください。");
      return;
    }
    if (mode === "office" && !v.interview_type) {
      setError("面談種別を選んでください。");
      return;
    }
    // 高ストレス面接指導は、本人の申出(=会社への結果の提供に同意)がある方だけを登録する。
    // 申出のない方を高ストレス面接指導として登録すると、高ストレスであることが会社に伝わってしまうため
    if (mode === "office" && confirmReady && needsConfirm && !v.request_confirmed) {
      setError(
        "高ストレス面接指導は、本人から面接指導の申出があった方だけ登録できます。申出があった場合はチェックを入れてください。申出のない方の相談は「その他・健康相談等」で登録してください。"
      );
      return;
    }
    // 生年月日の必須/任意は lib/personPolicy.ts で切り替える(同姓同名がいる場合は下で別途求める)
    if (BIRTH_DATE_REQUIRED && mode === "office" && !v.person_id && !v.birth_date) {
      setError("生年月日を入力してください（例: 1975/4/1）。");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const userId = await currentUserId(supabase);

    const schedulePayload = {
      // 日付のみを保持する(時刻は正午扱いにしてタイムゾーンによる日付ずれを防ぐ)
      scheduled_at: v.scheduled_local
        ? new Date(`${v.scheduled_local}T12:00:00`).toISOString()
        : null,
      method: v.method || null,
      location: v.location || null,
    };

    // 氏名を直接入力した場合もカルテに反映する:
    // 同姓同名のカルテがあればそれに紐付け、なければ自動作成する
    let personId = v.person_id;
    let targetUserId = v.target_user_id;
    if (mode === "office" && !personId && v.target_name.trim()) {
      const name = v.target_name.trim();
      const { data: existing } = await supabase
        .from("hm_persons")
        .select("id, user_id, birth_date")
        .eq("company_id", v.company_id)
        .eq("full_name", name);

      // 同姓同名がいる場合は生年月日で本人を特定する(未入力なら入力を求める)
      if (existing && existing.length > 0 && !v.birth_date) {
        setError(
          "同一企業に同姓同名の方が登録されています。上の検索欄からカルテを選択するか、区別のため生年月日を入力してください。"
        );
        setBusy(false);
        return;
      }

      const matched = (existing ?? []).find(
        (p) => !v.birth_date || p.birth_date === v.birth_date
      );
      if (matched) {
        personId = matched.id;
        targetUserId = matched.user_id ?? targetUserId;
      } else {
        const { data: created, error: personErr } = await supabase
          .from("hm_persons")
          .insert({
            company_id: v.company_id,
            full_name: name,
            birth_date: v.birth_date || null,
            created_by: userId,
          })
          .select("id")
          .single();
        if (personErr || !created) {
          setError(`カルテの自動作成に失敗しました: ${personErr?.message ?? "unknown"}`);
          setBusy(false);
          return;
        }
        personId = created.id;
        logAccessInBackground(supabase, {
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
              target_user_id: targetUserId,
              target_name: v.target_name.trim(),
              interview_type: v.interview_type,
              ...confirmPayload,
            }
          : schedulePayload;
      const { error } = await supabase.from("hm_interviews").update(payload).eq("id", id);
      if (error) {
        setError(`保存に失敗しました: ${error.message}`);
        setBusy(false);
        return;
      }
      logAccessInBackground(supabase, {
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
          target_user_id: targetUserId,
          target_name: v.target_name.trim(),
          interview_type: v.interview_type,
          ...confirmPayload,
          ...schedulePayload,
          created_by: userId,
        })
        .select("id")
        .single();
      if (error || !data) {
        setError(`登録に失敗しました: ${error?.message ?? "unknown"}`);
        setBusy(false);
        return;
      }
      id = data.id;
      logAccessInBackground(supabase, {
        p_action: "create",
        p_target_table: "hm_interviews",
        p_target_id: id ?? null,
      });
    }
    startNavigationProgress();
    // 動的ページはブラウザ側に保持しない設定(next.config)なので、移動だけで最新の内容が表示される
    router.replace(`/interviews/${id}`);
  };

  return (
    <form onSubmit={onSubmit}>
      {mode === "office" && (
        <>
          <div className="form-row">
            <label>対象者（カルテから選択。面談がカルテの履歴に紐付きます）</label>
            <input
              type="text"
              value={personQuery}
              onChange={(e) => setPersonQuery(e.target.value)}
              placeholder="社員番号・氏名・フリガナ・部署で検索"
              style={{ maxWidth: 340, marginBottom: 6 }}
              aria-label="従業員を検索"
            />
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
              {filteredPersons.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.employee_no ? `${person.employee_no} ` : ""}
                  {person.full_name}
                  {person.department ? `（${person.department}）` : ""}
                </option>
              ))}
            </select>
            {personQuery && (
              <p className="muted" style={{ margin: "4px 0 0" }}>
                {filteredPersons.length}名が一致（全{persons.length}名）
                {filteredPersons.length === 0 && " — 該当者がいない場合は下に氏名を直接入力してください"}
              </p>
            )}
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
                <label>{BIRTH_DATE_LABEL}</label>
                <DateTextInput
                  value={v.birth_date}
                  onChange={(val) => set("birth_date", val)}
                  required={BIRTH_DATE_REQUIRED}
                />
              </div>
            )}
          </div>
          {!v.person_id && (
            <p className="muted" style={{ margin: "-8px 0 14px" }}>
              カルテ未登録の方は、入力内容で個人カルテを自動作成します。
              {!BIRTH_DATE_REQUIRED && "生年月日は任意ですが、同姓同名の方がいる場合は区別のために入力が必要です。"}
            </p>
          )}
          <div className="form-row">
            <label>面談種別 *</label>
            <select
              value={v.interview_type}
              onChange={(e) => set("interview_type", e.target.value)}
              required
            >
              <option value="">（選んでください）</option>
              {Object.entries(INTERVIEW_TYPES).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            {v.interview_type === "high_stress" && v.interview_request_id && (
              <p className="muted" style={{ margin: "6px 0 0" }}>
                ストレスチェックWebで本人が面接指導を申し出た面談です(会社への結果の提供に同意済み)。
              </p>
            )}
            {confirmReady && needsConfirm && (
              <div style={{ marginTop: 8, background: "var(--orange-light)", border: "1px solid var(--orange)", borderRadius: 8, padding: "10px 12px" }}>
                <label style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: 0, fontWeight: 700, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={Boolean(v.request_confirmed)}
                    onChange={(e) => set("request_confirmed", e.target.checked)}
                    style={{ width: "auto", marginTop: 4 }}
                  />
                  <span>本人から面接指導の申出があった（会社への結果の提供に同意している）</span>
                </label>
                <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
                  「高ストレス面接指導」の予定は、会社の担当者にも見えます。ストレスチェックの結果は本人の同意なく会社に伝えられないため、
                  申出のあった方だけを登録してください（紙で受検した方の申出など）。
                  申出のない方の相談は、「その他・健康相談等」で登録してください。
                </p>
              </div>
            )}
          </div>
        </>
      )}

      <div className="form-row">
        <label>予定日</label>
        <input
          type="date"
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
        <button type="button" className="btn secondary" onClick={() => { startNavigationProgress(); router.push(backHref); }}>
          キャンセル
        </button>
      </div>
    </form>
  );
}
