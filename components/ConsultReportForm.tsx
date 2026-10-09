"use client";

import { FormEvent, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { formatDateJa } from "@/lib/fiscal";
import { REPORT_FORM_RESULTS } from "@/lib/notice";
import { normalizeDate } from "@/lib/checkups";

type VerifyKind = "birth_date" | "employee_no" | "name" | "invalid" | "expired";

// 生年月日はカレンダーではなく数字で直接入力する(カレンダーから何十年も遡るのは大変なため)。
// 「19850304」「1985/3/4」「S60.3.4」「昭和60年3月4日」などを受け付け、送信前に YYYY-MM-DD にそろえる
const QUESTION: Record<string, { label: string; placeholder: string; type: "date" | "text" }> = {
  birth_date: { label: "ご本人の生年月日（数字8けた。例: 1985年3月4日なら 19850304）", placeholder: "例: 19850304", type: "text" },
  employee_no: { label: "社員番号", placeholder: "例: 1234", type: "text" },
  name: { label: "お名前（通知書の宛名のとおり）", placeholder: "例: 山田 太郎", type: "text" },
};

type Lookup = {
  target_name: string;
  company_name: string | null;
  checkup_date: string | null;
  work_judgment_note: string | null;
  last_submitted_at: string | null;
};

// 受診勧奨通知のQRコードから開く受診報告(ログイン不要。受付番号+本人確認で保護)
// demoInfo を渡すと紹介用デモになり、データベースに触れず、本人確認の入力内容を問わず表示し、送信しても保存しない
export default function ConsultReportForm({ token, demoInfo }: { token: string; demoInfo?: Lookup }) {
  const [kind, setKind] = useState<VerifyKind | null>(null);
  const [answer, setAnswer] = useState("");
  const [info, setInfo] = useState<Lookup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const [visitDate, setVisitDate] = useState("");
  const [facility, setFacility] = useState("");
  const [department, setDepartment] = useState("");
  const [result, setResult] = useState("");
  const [instruction, setInstruction] = useState("");

  // 本人確認に送る値(生年月日は YYYY-MM-DD にそろえる。読み取れなければ入力のまま)
  const birthNormalized = kind === "birth_date" ? normalizeDate(answer) : null;
  const answerToSend = kind === "birth_date" ? birthNormalized ?? answer : answer;

  useEffect(() => {
    if (demoInfo) {
      setKind("birth_date");
      return;
    }
    const supabase = createClient();
    supabase
      .rpc("hm_report_verify_kind", { p_token: token })
      .then(({ data, error }) => {
        if (error) setKind("invalid");
        else setKind((data as VerifyKind) ?? "invalid");
      });
  }, [token, demoInfo]);

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (demoInfo) {
      setBusy(false);
      setInfo(demoInfo);
      return;
    }
    const supabase = createClient();
    const { data, error } = await supabase.rpc("hm_report_lookup", { p_token: token, p_answer: answerToSend });
    setBusy(false);
    if (error || !data) {
      setError("入力内容が通知書の情報と一致しません。もう一度ご確認ください。");
      return;
    }
    setInfo(data as Lookup);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!visitDate) {
      setError("受診日を入力してください。");
      return;
    }
    if (!result) {
      setError("受診結果を選んでください。");
      return;
    }
    setBusy(true);
    setError(null);
    if (demoInfo) {
      setBusy(false);
      setDone(true);
      return;
    }
    const supabase = createClient();
    const { error } = await supabase.rpc("hm_report_submit", {
      p_token: token,
      p_answer: answerToSend,
      p_visit_date: visitDate,
      p_facility: facility,
      p_department: department,
      p_result: result,
      p_instruction: instruction,
    });
    setBusy(false);
    if (error) {
      setError("送信できませんでした。時間をおいて再度お試しいただくか、担当部署へ直接ご報告ください。");
      return;
    }
    setDone(true);
  };

  if (kind === null) return <p className="muted">読み込んでいます…</p>;

  if (kind === "invalid" || kind === "expired") {
    return (
      <div className="card">
        <h2>この受付番号は使えません</h2>
        <p>
          {kind === "expired"
            ? "通知書の発行から1年以上が経過しているため、この QR コードは無効です。"
            : "QR コードの読み取りに失敗したか、無効な受付番号です。"}
          お手数ですが、担当部署へ直接ご報告ください。
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="card">
        <h2>受診報告を送信しました</h2>
        <p>
          ご報告ありがとうございました。内容は担当部署と産業医が確認します。
          受診結果のわかる書類（結果報告書・診断書など）があれば、担当部署へご提出ください。
        </p>
        <p className="muted">このページは閉じていただいて構いません。</p>
      </div>
    );
  }

  if (!info) {
    const q = QUESTION[kind];
    return (
      <form className="card" onSubmit={verify}>
        <h2>本人確認</h2>
        <p className="muted">通知書をお持ちのご本人であることを確認します。</p>
        <div className="form-row">
          <label>{q.label}</label>
          <input
            type={q.type}
            inputMode={kind === "birth_date" ? "numeric" : undefined}
            autoComplete={kind === "birth_date" ? "bday" : undefined}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder={q.placeholder}
            required
            autoFocus
          />
          {kind === "birth_date" && answer.trim() !== "" && (
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
              {birthNormalized
                ? `${formatDateJa(birthNormalized)} として確認します`
                : "日付として読み取れません。例: 19850304 / 1985/3/4 / S60.3.4"}
            </p>
          )}
        </div>
        {error && <p className="error-message">{error}</p>}
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "確認中…" : "次へ"}
        </button>
      </form>
    );
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>{info.target_name} 様の受診報告</h2>
      <table className="list" style={{ marginBottom: 12 }}>
        <tbody>
          {info.company_name && (
            <tr>
              <th style={{ width: 110 }}>会社</th>
              <td>{info.company_name}</td>
            </tr>
          )}
          <tr>
            <th style={{ width: 110 }}>健診日</th>
            <td>{formatDateJa(info.checkup_date)}</td>
          </tr>
          {info.work_judgment_note && (
            <tr>
              <th>医師の意見</th>
              <td style={{ whiteSpace: "pre-wrap" }}>{info.work_judgment_note}</td>
            </tr>
          )}
        </tbody>
      </table>
      {info.last_submitted_at && (
        <div className="notice">
          {new Date(info.last_submitted_at).toLocaleString("ja-JP")} に送信済みの報告があります。
          追加の報告（精密検査の結果など）があれば、続けて送信できます。
        </div>
      )}

      <div className="form-row">
        <label>受診日 *</label>
        <input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} required />
      </div>
      <div className="form-row">
        <label>医療機関名</label>
        <input type="text" value={facility} onChange={(e) => setFacility(e.target.value)} placeholder="例: ○○クリニック" />
      </div>
      <div className="form-row">
        <label>診療科</label>
        <input type="text" value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="例: 内科" />
      </div>
      <div className="form-row">
        <label>受診結果 *</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {REPORT_FORM_RESULTS.map((r) => (
            <label key={r} htmlFor={`result-${r}`} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 15 }}>
              <input
                id={`result-${r}`}
                type="radio"
                name="result"
                value={r}
                checked={result === r}
                onChange={() => setResult(r)}
                style={{ width: 18, height: 18 }}
              />
              {r}
            </label>
          ))}
        </div>
      </div>
      <div className="form-row">
        <label>診断名・医師からの指示（任意）</label>
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="例: 脂肪肝。3か月後に再検査。飲酒を控えるよう指導あり"
          style={{ minHeight: 90 }}
        />
      </div>
      {error && <p className="error-message">{error}</p>}
      <button className="btn orange" type="submit" disabled={busy} style={{ width: "100%", padding: "12px 0", fontSize: 16 }}>
        {busy ? "送信中…" : "受診報告を送信する"}
      </button>
      <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
        送信した内容は、会社の担当部署と産業医のみが確認します。
      </p>
    </form>
  );
}
