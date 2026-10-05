"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PrintButton from "@/components/PrintButton";
import QrCode from "@/components/QrCode";
import type { CheckupRow } from "@/components/CheckupsTable";
import { createClient } from "@/lib/supabase/browser";
import { formatDateJa } from "@/lib/fiscal";
import type { OfficeInfo } from "@/lib/officeInfo";
import {
  CHECKUP_TYPES,
  CHECKUP_WORK_JUDGMENTS,
  FOLLOWUP_STATUS,
  conditionLabel,
  isSevereJudgment,
  roundLabel,
} from "@/lib/checkups";
import { INTERVIEW_METHODS } from "@/lib/interviews";
import {
  NOTICE_TEMPLATES,
  REPORT_FORM_RESULTS,
  REPORT_FORM_TITLE,
  type NoticeKind,
} from "@/lib/notice";

// 従業員へ渡す通知文書(受診勧奨通知・産業医面談通知):
// 対象者(あらかじめ絞り込み済み・全員チェック付き)を1人1ページで連続表示し、まとめて印刷/PDF保存する
export default function CheckupNoticesView({
  kind,
  companyName,
  companyAddress,
  officeInfo,
  fiscalYear,
  round,
  rows,
  canFollowup,
  demo = false,
}: {
  kind: NoticeKind;
  companyName: string;
  companyAddress: string | null;
  officeInfo: OfficeInfo | null;
  fiscalYear: number;
  round?: number;
  rows: CheckupRow[]; // 通知の対象者(呼び出し側で絞り込み済み)
  canFollowup: boolean; // 通知後に受診勧奨の状態を「勧奨済」にできるか
  demo?: boolean; // 紹介用デモ(データベースに触れない。QRコードはデモの受診報告ページを指す)
}) {
  const router = useRouter();
  const tpl = NOTICE_TEMPLATES[kind];
  const today = new Date().toISOString().slice(0, 10);
  const [title, setTitle] = useState(tpl.title);
  const [body, setBody] = useState(tpl.body);
  const [closing, setClosing] = useState(tpl.closing);
  const [issuedDate, setIssuedDate] = useState(today);
  const [contact, setContact] = useState("");
  // 受診勧奨通知: 文書の下に付ける「受診報告」欄(提出期限は全員共通・任意)
  const [withReportForm, setWithReportForm] = useState(true);
  const [reportDeadline, setReportDeadline] = useState("");
  // 産業医面談通知: 面談の日時・場所(文書に印字し、そのまま面談予定の登録にも使う)
  const [interviewDate, setInterviewDate] = useState("");
  const [interviewTime, setInterviewTime] = useState("");
  const [interviewMethod, setInterviewMethod] = useState("in_person");
  const [interviewLocation, setInterviewLocation] = useState("");
  // 対象者は呼び出し側で絞り込み済み。最初は全員にチェックが入り、外したい方だけチェックを外す
  const [selected, setSelected] = useState<Set<string>>(() => new Set(rows.map((c) => c.id)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // 受診勧奨通知: 本人専用のQRコード(受付番号)。選択した方の分を発行して文書に印字する
  const [withQr, setWithQr] = useState(true);
  const [tokens, setTokens] = useState<Map<string, string>>(new Map());
  const [qrUnavailable, setQrUnavailable] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  useEffect(() => {
    if (!tpl.hasQrReport || !withQr) return;
    const missing = rows.filter((c) => selected.has(c.id) && !tokens.has(c.id)).map((c) => c.id);
    if (missing.length === 0) return;
    if (demo) {
      // デモでは受付番号を発行せず、全員のQRコードをデモの受診報告ページに向ける
      setTokens((prev) => {
        const next = new Map(prev);
        for (const id of missing) next.set(id, "demo");
        return next;
      });
      return;
    }
    let alive = true;
    const supabase = createClient();
    supabase.rpc("hm_ensure_report_tokens", { p_ids: missing }).then(({ data, error }) => {
      if (!alive) return;
      if (error) {
        setQrUnavailable(
          /function|schema cache|relation/i.test(error.message)
            ? "QRコードの印字には SQL(0142_hm_consult_reports.sql)の適用が必要です。適用されるまでは紙の「受診報告」欄のみ印字されます。"
            : `QRコードを発行できませんでした: ${error.message}`
        );
        return;
      }
      setTokens((prev) => {
        const next = new Map(prev);
        for (const r of (data ?? []) as { id: string; token: string }[]) next.set(r.id, r.token);
        return next;
      });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, withQr, tpl.hasQrReport]);
  const reportUrl = (id: string) => {
    const t = tokens.get(id);
    if (!t || !origin) return null;
    return demo ? `${origin}/demo/report` : `${origin}/report/${t}`;
  };

  const physicianName = officeInfo?.physician_name || "上松弘典";
  const officeName = officeInfo?.office_name || "うえまつ産業医事務所";

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const targets = rows.filter((c) => selected.has(c.id));
  const notYetRecommended = targets.filter((c) => c.followup_status === "pending");

  // 通知を出した方の受診勧奨の状態を「勧奨済」にする(一覧の「受診勧奨」欄と同じRPC)
  const markRecommended = async () => {
    if (notYetRecommended.length === 0) return;
    const ok = window.confirm(
      `選択中の ${notYetRecommended.length}名（受診勧奨が未対応の方）を「勧奨済」にします。よろしいですか？`
    );
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    let done = 0;
    let failed = 0;
    for (const c of notYetRecommended) {
      const { error } = await supabase.rpc("hm_set_followup", {
        p_id: c.id,
        p_status: "recommended",
        p_note: null,
      });
      if (error) failed++;
      else done++;
    }
    setBusy(false);
    setMessage(
      failed > 0
        ? `${done}名を「勧奨済」にしました（${failed}名は更新できませんでした）。`
        : `${done}名を「勧奨済」にしました。`
    );
    router.refresh();
  };

  // 文書に印字する「面談の日時・場所」(例: 2026年10月20日 13:00〜 対面 本社3階 相談室)
  const interviewWhenWhere = [
    interviewDate ? formatDateJa(interviewDate) : "",
    interviewTime.trim(),
    interviewMethod ? INTERVIEW_METHODS[interviewMethod] : "",
    interviewLocation.trim(),
  ]
    .filter(Boolean)
    .join("　");

  // 選択した方の面談予定を産業医面談管理にまとめて登録する(同じ健診結果からの登録は二重にしない)
  const registerInterviews = async () => {
    if (targets.length === 0) return;
    if (!interviewDate) {
      setMessage("面談日を入力してください。");
      return;
    }
    const ok = window.confirm(
      `選択中の ${targets.length}名について、${formatDateJa(interviewDate)} の「健診事後措置面談」を産業医面談管理に登録します。\n` +
        `すでに同じ健診結果から登録された面談がある方は登録されません。よろしいですか？`
    );
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("hm_bulk_create_interviews", {
      p_checkup_ids: targets.map((c) => c.id),
      p_scheduled_date: interviewDate,
      p_method: interviewMethod || null,
      p_location: [interviewTime.trim(), interviewLocation.trim()].filter(Boolean).join(" ") || null,
    });
    setBusy(false);
    if (error) {
      setMessage(
        /function|schema cache/i.test(error.message)
          ? "面談の一括登録には SQL(0141_hm_bulk_create_interviews.sql)の適用が必要です。"
          : `面談の登録に失敗しました: ${error.message}`
      );
      return;
    }
    const r = (data ?? {}) as { created?: number; skipped?: number };
    setMessage(
      `${r.created ?? 0}名の面談予定を産業医面談管理に登録しました` +
        (r.skipped ? `（${r.skipped}名は登録済みのため省略）。` : "。")
    );
    router.refresh();
  };

  // 文書に載せる項目は要医療(D)・就業制限の検討(R)の項目だけ。
  // C(要経過観察)は受診勧奨の対象ではないため載せない(例: BMI 25.7(C) は載せない)
  const findingsText = (c: CheckupRow) =>
    (c.findingItems ?? [])
      .filter((f) => isSevereJudgment(f.judgment))
      .map((f) => `${f.item_name}${f.value ? ` ${f.value}` : ""}（${f.judgment}）`)
      .join("、");

  return (
    <div>
      <div className="card no-print">
        <h2>1. 通知する方（{rows.length}名・あらかじめ絞り込み済み）</h2>
        <p className="muted">
          {tpl.targetHint}
          全員にチェックが入っています。今回は通知しない方がいればチェックを外してください（就業判定が未入力・判定保留の方は含まれません）。
        </p>
        {selected.size < rows.length && (
          <div style={{ marginBottom: 8 }}>
            <button
              className="btn secondary"
              style={{ padding: "3px 10px", fontSize: 12 }}
              onClick={() => setSelected(new Set(rows.map((c) => c.id)))}
            >
              全員にチェックを戻す
            </button>
          </div>
        )}
        {rows.length === 0 ? (
          <p className="muted">この年度に{tpl.label}の対象となる方はいません。</p>
        ) : (
          <div style={{ overflowX: "auto", maxHeight: 360, overflowY: "auto" }}>
            <table className="list">
              <thead>
                <tr>
                  <th style={{ width: 34 }}></th>
                  <th>氏名</th>
                  <th>所属</th>
                  <th>総合判定</th>
                  <th>就業判定</th>
                  <th>受診勧奨</th>
                  <th>医師の意見</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} style={selected.has(c.id) ? {} : { opacity: 0.5 }}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggle(c.id)}
                        aria-label={`${c.target_name}を選択`}
                      />
                    </td>
                    <td>
                      {c.target_name}
                      {c.employee_no && (
                        <span className="muted" style={{ fontSize: 11, marginLeft: 4 }}>
                          {c.employee_no}
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: 13 }}>{c.department || "—"}</td>
                    <td>{c.overall_judgment || "—"}</td>
                    <td style={{ fontSize: 13 }}>
                      {c.work_judgment ? CHECKUP_WORK_JUDGMENTS[c.work_judgment] : "—"}
                      {c.work_judgment_condition && (
                        <span className="muted">（{conditionLabel(c.work_judgment_condition)}）</span>
                      )}
                    </td>
                    <td style={{ fontSize: 13 }}>
                      <span style={c.followup_status === "pending" ? { color: "var(--orange)", fontWeight: 700 } : {}}>
                        {FOLLOWUP_STATUS[c.followup_status ?? "none"] ?? "—"}
                      </span>
                    </td>
                    <td style={{ fontSize: 13 }}>{c.work_judgment_note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card no-print">
        <h2>2. 通知文を確認・編集する（全員に共通）</h2>
        <p className="muted">
          「印刷 / PDFとして保存」を押すと、選択した <strong>{targets.length}名</strong>
          分が1人1ページで出力されます。各ページには、その方の健診日・総合判定・受診をお勧めする項目（要医療D・就業制限Rの項目のみ）・
          就業判定・医師の意見が自動で入ります。
        </p>
        <div className="form-row">
          <label>表題</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="form-row">
          <label>本文（判定内容の前に入ります）</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} style={{ minHeight: 130 }} />
        </div>
        {tpl.canRegisterInterview && (
          <div
            className="form-row"
            style={{ background: "var(--teal-light)", border: "1px solid var(--teal)", borderRadius: 8, padding: "10px 14px" }}
          >
            <label style={{ fontWeight: 700 }}>面談の日時・場所（全員に共通・文書に印字されます）</label>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <label className="muted" style={{ display: "block", fontSize: 12 }}>面談日</label>
                <input type="date" value={interviewDate} onChange={(e) => setInterviewDate(e.target.value)} />
              </div>
              <div>
                <label className="muted" style={{ display: "block", fontSize: 12 }}>時間（任意）</label>
                <input
                  type="text"
                  value={interviewTime}
                  onChange={(e) => setInterviewTime(e.target.value)}
                  placeholder="例: 13:00〜"
                  style={{ width: 120 }}
                />
              </div>
              <div>
                <label className="muted" style={{ display: "block", fontSize: 12 }}>方法</label>
                <select value={interviewMethod} onChange={(e) => setInterviewMethod(e.target.value)}>
                  {Object.entries(INTERVIEW_METHODS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label className="muted" style={{ display: "block", fontSize: 12 }}>場所・URL（任意）</label>
                <input
                  type="text"
                  value={interviewLocation}
                  onChange={(e) => setInterviewLocation(e.target.value)}
                  placeholder="例: 本社3階 相談室"
                />
              </div>
            </div>
            {canFollowup && (
              <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button
                  className="btn orange"
                  onClick={registerInterviews}
                  disabled={busy || targets.length === 0 || !interviewDate}
                >
                  {busy ? "処理中…" : `選択した ${targets.length}名の面談予定を産業医面談管理に登録`}
                </button>
                <span className="muted" style={{ fontSize: 12 }}>
                  面談種別「健診事後措置面談」・状態「予定」で登録します。同じ健診結果から登録済みの方は二重に登録しません。
                </span>
              </div>
            )}
          </div>
        )}
        <div className="form-row">
          <label>結び（判定内容の後に入ります）</label>
          <textarea value={closing} onChange={(e) => setClosing(e.target.value)} style={{ minHeight: 60 }} />
        </div>
        <div className="form-row" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div>
            <label>発行日</label>
            <input type="date" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label>担当部署・連絡先（差出人欄の産業医の上に「担当部署　○○」と印字。空欄なら手書き用の空白）</label>
            <input
              type="text"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="例: 総務部 ○○（内線123）"
            />
          </div>
        </div>
        {tpl.hasReportForm && (
          <div
            className="form-row"
            style={{ background: "var(--teal-light)", border: "1px solid var(--teal)", borderRadius: 8, padding: "10px 14px" }}
          >
            <label htmlFor="with-qr" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
              <input
                id="with-qr"
                type="checkbox"
                checked={withQr}
                onChange={(e) => setWithQr(e.target.checked)}
                style={{ width: 16, height: 16 }}
              />
              本人専用のQRコードを印字する（スマートフォンで読み取って受診報告を送信。送信されると受診勧奨が「受診済」になります）
            </label>
            {withQr && qrUnavailable && (
              <p className="error-message" style={{ margin: "4px 0 8px" }}>{qrUnavailable}</p>
            )}
            <label htmlFor="with-report-form" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
              <input
                id="with-report-form"
                type="checkbox"
                checked={withReportForm}
                onChange={(e) => setWithReportForm(e.target.checked)}
                style={{ width: 16, height: 16 }}
              />
              文書の下に「受診報告」欄を付ける（本人が受診後に記入し、担当部署へ提出する雛形）
            </label>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginTop: 6 }}>
              <div>
                <label className="muted" style={{ display: "block", fontSize: 12 }}>報告の提出期限（任意・全員に共通）</label>
                <input
                  type="date"
                  value={reportDeadline}
                  onChange={(e) => setReportDeadline(e.target.value)}
                  disabled={!withReportForm}
                />
              </div>
              <span className="muted" style={{ fontSize: 12 }}>
                受診日・医療機関・診療科・受診結果・医師からの指示・本人署名の欄が入ります。
              </span>
            </div>
          </div>
        )}
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <PrintButton />
          <span className="muted" style={{ fontSize: 12 }}>
            印刷ダイアログで「送信先: PDFに保存」を選ぶと、全員分が1つのPDFになります。
          </span>
        </div>
        {tpl.canMarkRecommended && canFollowup && notYetRecommended.length > 0 && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
            <button className="btn secondary" onClick={markRecommended} disabled={busy}>
              {busy ? "処理中…" : `通知した ${notYetRecommended.length}名を「勧奨済」にする`}
            </button>
            <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
              受診勧奨が「未対応」の方だけが対象です。一覧の「受診勧奨」欄にも反映されます。
            </span>
          </div>
        )}
        {message && <p style={{ color: "var(--teal-dark)", fontSize: 13, marginTop: 8 }}>{message}</p>}
      </div>

      <h2 className="no-print" style={{ fontSize: 15, margin: "6px 0 10px" }}>
        3. 出力イメージ（{targets.length}名・1人1ページ）
      </h2>

      {targets.map((c) => {
        const findings = findingsText(c);
        const type = `${CHECKUP_TYPES[c.checkup_type] ?? c.checkup_type}${roundLabel(round)}`;
        // 産業医面談通知は文章量が少ないので、余白と行間を広めにとる
        const roomy = kind === "interview";
        return (
          <div
            className={`card sheet-break print-sheet notice-sheet${kind === "interview" ? " notice-roomy" : ""}`}
            key={c.id}
          >
            <div style={{ textAlign: "right", fontSize: 13 }}>{formatDateJa(issuedDate)}</div>
            <div style={{ margin: roomy ? "12px 0 22px" : "6px 0 12px", fontSize: 16 }}>
              {c.department && <span className="muted">{c.department}　</span>}
              {c.employee_no && <span className="muted">社員番号 {c.employee_no}　</span>}
              <strong>{c.target_name} 様</strong>
            </div>

            <h2
              style={{
                textAlign: "center",
                fontSize: 18,
                margin: roomy ? "0 0 22px" : "0 0 12px",
                border: "none",
                padding: 0,
                color: "var(--ink)",
              }}
            >
              {title}
            </h2>

            <div style={{ whiteSpace: "pre-wrap", marginBottom: roomy ? 24 : 16 }}>{body}</div>

            <table className="list" style={{ marginBottom: roomy ? 24 : 16 }}>
              <tbody>
                <tr>
                  <th style={{ width: 150 }}>健康診断</th>
                  <td>
                    {fiscalYear}年度 {type}（{formatDateJa(c.checkup_date)}）
                  </td>
                </tr>
                <tr>
                  <th>総合判定</th>
                  <td>
                    <strong>{c.overall_judgment || "—"}</strong>
                  </td>
                </tr>
                {findings && (
                  <tr>
                    <th>{kind === "interview" ? "要医療・就業制限の項目" : "受診をお勧めする項目"}</th>
                    <td>{findings}</td>
                  </tr>
                )}
                <tr>
                  <th>就業判定</th>
                  <td>
                    {c.work_judgment ? CHECKUP_WORK_JUDGMENTS[c.work_judgment] : "—"}
                    {c.work_judgment_condition && `（${conditionLabel(c.work_judgment_condition)}）`}
                    {c.work_judgment_date && (
                      <span className="muted">　{formatDateJa(c.work_judgment_date)}</span>
                    )}
                  </td>
                </tr>
                <tr>
                  <th>医師の意見</th>
                  <td style={{ whiteSpace: "pre-wrap" }}>
                    <strong>{c.work_judgment_note || "—"}</strong>
                  </td>
                </tr>
                {tpl.canRegisterInterview && interviewWhenWhere && (
                  <tr>
                    <th>面談の日時・場所</th>
                    <td>
                      <strong>{interviewWhenWhere}</strong>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {/* 本人専用のQRコード: 読み取ると受診報告のページが開く(本人確認あり) */}
            {tpl.hasQrReport && withQr && reportUrl(c.id) && (
              <div
                style={{
                  display: "flex",
                  gap: 14,
                  alignItems: "center",
                  border: "1px solid var(--teal)",
                  borderRadius: 8,
                  padding: "10px 14px",
                  marginBottom: 16,
                }}
              >
                <QrCode value={reportUrl(c.id)!} size={96} />
                <div style={{ fontSize: 12 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                    📱 スマートフォンで受診報告を送る
                  </div>
                  <div>
                    受診後にこのQRコードを読み取り、受診日・医療機関・受診結果を入力して送信してください。
                  </div>
                  <div className="muted" style={{ marginTop: 4 }}>
                    開くときに本人確認（生年月日など）があります。このQRコードはご本人専用です。他の方に渡さないでください。
                  </div>
                </div>
              </div>
            )}

            <div style={{ whiteSpace: "pre-wrap", marginBottom: roomy ? 36 : 18 }}>{closing}</div>

            <div style={{ textAlign: "right" }}>
              <div>{companyName}</div>
              {companyAddress && <div className="muted">{companyAddress}</div>}
              {/* 担当部署(問い合わせ先)は産業医の上に必ず載せる。未入力なら手書き用の空欄 */}
              <div>担当部署　{contact || "　　　　　　　　　　　　"}</div>
              <div style={{ marginTop: 6 }}>
                産業医　{physicianName}
                <span className="muted">（{officeName}）</span>
              </div>
            </div>

            {/* 受診報告欄: 本人が受診後に記入して担当部署へ提出する雛形(切り取り線の下) */}
            {tpl.hasReportForm && withReportForm && (
              <div style={{ marginTop: 22, borderTop: "1px dashed #888", paddingTop: 10, fontSize: 12 }}>
                <div className="muted" style={{ fontSize: 11, marginTop: -18, marginBottom: 8, background: "#fff", display: "inline-block", padding: "0 6px" }}>
                  ✂ キリトリ線
                </div>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{REPORT_FORM_TITLE}</div>
                <table className="list" style={{ fontSize: 12 }}>
                  <tbody>
                    <tr>
                      <th style={{ width: 130 }}>氏名</th>
                      <td style={{ width: "40%" }}>
                        {c.target_name}
                        {c.employee_no && <span className="muted">（{c.employee_no}）</span>}
                      </td>
                      <th style={{ width: 100 }}>受診日</th>
                      <td>　　　年　　月　　日</td>
                    </tr>
                    <tr>
                      <th>医療機関名</th>
                      <td></td>
                      <th>診療科</th>
                      <td></td>
                    </tr>
                    <tr>
                      <th>受診結果</th>
                      <td colSpan={3}>
                        {REPORT_FORM_RESULTS.map((r) => (
                          <span key={r} style={{ marginRight: 12, whiteSpace: "nowrap" }}>
                            □ {r}
                          </span>
                        ))}
                      </td>
                    </tr>
                    <tr>
                      <th>診断名・医師からの指示</th>
                      <td colSpan={3} style={{ height: 44, verticalAlign: "top" }}>
                        <span className="muted" style={{ fontSize: 11 }}>
                          （例: 通院治療中、就業上の注意、次回受診の予定 など）
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <th>提出日・署名</th>
                      <td colSpan={3}>
                        　　　年　　月　　日　　署名：
                        {reportDeadline && (
                          <span style={{ marginLeft: 12, fontWeight: 700 }}>
                            提出期限：{formatDateJa(reportDeadline)}
                          </span>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                  受診結果のわかる書類（結果報告書・診断書など）があれば添えてご提出ください。提出先：
                  {contact || "担当部署"}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
