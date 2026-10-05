"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import PrintButton from "@/components/PrintButton";
import type { CheckupRow } from "@/components/CheckupsTable";
import { createClient } from "@/lib/supabase/browser";
import { formatDateJa } from "@/lib/fiscal";
import type { OfficeInfo } from "@/lib/officeInfo";
import {
  CHECKUP_TYPES,
  CHECKUP_WORK_JUDGMENTS,
  FOLLOWUP_STATUS,
  conditionLabel,
  isFindingJudgment,
  roundLabel,
} from "@/lib/checkups";
import { NOTICE_KINDS, NOTICE_TEMPLATES, type NoticeKind } from "@/lib/notice";

// 従業員へ渡す通知文書(受診勧奨通知・産業医面談通知):
// 対象者を選び、1人1ページで連続表示してまとめて印刷/PDF保存する
export default function CheckupNoticesView({
  kind,
  tabBasePath,
  companyName,
  companyAddress,
  officeInfo,
  fiscalYear,
  round,
  rows,
  canFollowup,
}: {
  kind: NoticeKind;
  tabBasePath: string; // タブのリンク先(?year=...&round=... まで含む)
  companyName: string;
  companyAddress: string | null;
  officeInfo: OfficeInfo | null;
  fiscalYear: number;
  round?: number;
  rows: CheckupRow[];
  canFollowup: boolean; // 通知後に受診勧奨の状態を「勧奨済」にできるか
}) {
  const router = useRouter();
  const tpl = NOTICE_TEMPLATES[kind];
  const today = new Date().toISOString().slice(0, 10);
  const [title, setTitle] = useState(tpl.title);
  const [body, setBody] = useState(tpl.body);
  const [closing, setClosing] = useState(tpl.closing);
  const [issuedDate, setIssuedDate] = useState(today);
  const [contact, setContact] = useState("");
  const [extra, setExtra] = useState("");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(rows.filter(tpl.isTarget).map((c) => c.id))
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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

  const findingsText = (c: CheckupRow) =>
    (c.findingItems ?? [])
      .filter((f) => isFindingJudgment(f.judgment))
      .map((f) => `${f.item_name}${f.value ? ` ${f.value}` : ""}（${f.judgment}）`)
      .join("、");

  return (
    <div>
      {/* 通知の種類(タブ) */}
      <p className="no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span className="muted">通知の種類:</span>
        {NOTICE_KINDS.map((k) => (
          <Link
            key={k}
            href={`${tabBasePath}&kind=${k}`}
            className={k === kind ? "badge" : ""}
            style={k === kind ? {} : { padding: "2px 8px" }}
          >
            {NOTICE_TEMPLATES[k].label}
          </Link>
        ))}
      </p>

      <div className="card no-print">
        <h2>1. 通知する方を選ぶ</h2>
        <p className="muted">{tpl.targetHint} 就業判定が未入力・判定保留の方は一覧に出ません。</p>
        <div style={{ display: "flex", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
          <button
            className="btn secondary"
            style={{ padding: "3px 10px", fontSize: 12 }}
            onClick={() => setSelected(new Set(rows.filter(tpl.isTarget).map((c) => c.id)))}
          >
            {tpl.label}の対象のみ選択
          </button>
          <button
            className="btn secondary"
            style={{ padding: "3px 10px", fontSize: 12 }}
            onClick={() => setSelected(new Set(rows.map((c) => c.id)))}
          >
            全選択
          </button>
          <button
            className="btn secondary"
            style={{ padding: "3px 10px", fontSize: 12 }}
            onClick={() => setSelected(new Set())}
          >
            全解除
          </button>
        </div>
        {rows.length === 0 ? (
          <p className="muted">この年度に就業判定が確定した健診結果はありません。</p>
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
                  <tr key={c.id} style={tpl.isTarget(c) ? { background: "#fffaf5" } : {}}>
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
          分が1人1ページで出力されます。各ページには、その方の健診日・総合判定・所見のあった項目・
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
        {tpl.extraLabel && (
          <div className="form-row">
            <label>{tpl.extraLabel}</label>
            <input
              type="text"
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder={tpl.extraPlaceholder}
            />
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
            <label>担当部署・連絡先（任意）</label>
            <input
              type="text"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="例: 総務部 ○○（内線123）"
            />
          </div>
        </div>
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
        return (
          <div className="card sheet-break print-sheet" key={c.id}>
            <div style={{ textAlign: "right", fontSize: 13 }}>{formatDateJa(issuedDate)}</div>
            <div style={{ margin: "8px 0 18px", fontSize: 16 }}>
              {c.department && <span className="muted">{c.department}　</span>}
              {c.employee_no && <span className="muted">社員番号 {c.employee_no}　</span>}
              <strong>{c.target_name} 様</strong>
            </div>

            <h2
              style={{
                textAlign: "center",
                fontSize: 18,
                margin: "0 0 18px",
                border: "none",
                padding: 0,
                color: "var(--ink)",
              }}
            >
              {title}
            </h2>

            <div style={{ whiteSpace: "pre-wrap", marginBottom: 16 }}>{body}</div>

            <table className="list" style={{ marginBottom: 16 }}>
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
                    <th>所見のあった項目</th>
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
                {tpl.extraLabel && extra && (
                  <tr>
                    <th>面談の日時・場所</th>
                    <td>
                      <strong>{extra}</strong>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div style={{ whiteSpace: "pre-wrap", marginBottom: 28 }}>{closing}</div>

            <div style={{ textAlign: "right" }}>
              <div>{companyName}</div>
              {companyAddress && <div className="muted">{companyAddress}</div>}
              {contact && <div>{contact}</div>}
              <div style={{ marginTop: 6 }}>
                産業医　{physicianName}
                <span className="muted">（{officeName}）</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
