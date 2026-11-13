import PrintButton from "@/components/PrintButton";
import type { CheckupRow } from "@/components/CheckupsTable";
import type { OfficeInfo } from "@/lib/officeInfo";
import { formatDateJa } from "@/lib/fiscal";
import { LEGAL_NOTE, conditionText, consultLabel, interviewNeeded, judgmentLabel, summarize } from "@/lib/workJudgmentReport";

const num: React.CSSProperties = { textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
const cell: React.CSSProperties = { fontSize: 12.5, verticalAlign: "top" };
const hd: React.CSSProperties = { whiteSpace: "nowrap", verticalAlign: "bottom" };

// 就業判定・事後措置報告書(産業医事務所が作成し、事業者に渡す)。印刷/PDF保存用(A4横)
export default function WorkJudgmentSheet({
  companyName,
  fiscalYear,
  round,
  groupLabel,
  rows,
  officeInfo,
}: {
  companyName: string;
  fiscalYear: number;
  round?: number;
  groupLabel?: string;
  rows: CheckupRow[];
  officeInfo: OfficeInfo | null;
}) {
  const s = summarize(rows);
  const office = officeInfo?.office_name ?? "うえまつ産業医事務所";
  const physician = officeInfo?.physician_name ?? "上松弘典";
  return (
    <div className="print-sheet wide-sheet">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 13 }}>{companyName} 御中</div>
          <h1 style={{ fontSize: 20, margin: "6px 0 2px" }}>健康診断結果に基づく就業判定・事後措置報告書</h1>
          <div className="muted" style={{ fontSize: 13 }}>
            {fiscalYear}年度{round ? `（第${round}回）` : ""}
            {groupLabel ? ` ${groupLabel}` : ""}
          </div>
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.7, textAlign: "right" }}>
          <div>作成日 {formatDateJa(new Date().toISOString().slice(0, 10))}</div>
          <div>
            <strong>{office}</strong>
          </div>
          {officeInfo?.address && <div>{officeInfo.address}</div>}
          {officeInfo?.tel && <div>TEL {officeInfo.tel}</div>}
          <div>産業医 {physician}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 12 }}>
        <table className="list" style={{ width: "auto" }}>
          <thead>
            <tr>
              <th colSpan={2}>就業判定</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>受診者数</td><td style={num}><strong>{s.total}</strong> 人</td></tr>
            <tr><td>通常勤務可{s.normalWithCondition > 0 ? `（うち受診が条件 ${s.normalWithCondition}人）` : ""}</td><td style={num}>{s.normal} 人</td></tr>
            <tr><td>要就業制限</td><td style={num}>{s.restricted} 人</td></tr>
            <tr><td>要休業</td><td style={num}>{s.leave} 人</td></tr>
            {s.pending > 0 && <tr><td>判定保留</td><td style={num}>{s.pending} 人</td></tr>}
            {s.unjudged > 0 && <tr><td>未判定</td><td style={num}>{s.unjudged} 人</td></tr>}
          </tbody>
        </table>
        <table className="list" style={{ width: "auto" }}>
          <thead>
            <tr>
              <th colSpan={2}>事後措置</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>受診勧奨</td><td style={num}>{s.consult} 人</td></tr>
            <tr><td>　うち受診済</td><td style={num}>{s.consultDone} 人</td></tr>
            <tr><td>産業医面談</td><td style={num}>{s.interview} 人</td></tr>
          </tbody>
        </table>
      </div>

      <table className="list">
        <thead>
          <tr>
            {/* 見出しは決めた位置で改行し、1文字ずつの縦書きにならないようにする */}
            <th style={hd}>社員<br />番号</th>
            <th style={hd}>氏名</th>
            <th style={hd}>所属</th>
            <th style={hd}>健診日</th>
            <th style={hd}>総合<br />判定</th>
            <th style={hd}>就業判定</th>
            <th style={{ ...hd, width: "30%" }}>医師の意見</th>
            <th style={hd}>受診勧奨</th>
            <th style={hd}>産業医<br />面談</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={cell}>{r.employee_no ?? ""}</td>
              <td style={{ ...cell, whiteSpace: "nowrap" }}>{r.target_name}</td>
              <td style={cell}>{r.department ?? ""}</td>
              <td style={{ ...cell, whiteSpace: "nowrap" }}>{r.checkup_date ?? ""}</td>
              <td style={cell}>{r.overall_judgment ?? ""}</td>
              <td style={{ ...cell, whiteSpace: "nowrap" }}>
                <strong>{judgmentLabel(r)}</strong>
                {conditionText(r) && <div style={{ fontSize: 11.5 }}>（{conditionText(r)}）</div>}
              </td>
              <td style={{ ...cell, whiteSpace: "pre-wrap" }}>{r.work_judgment_note ?? ""}</td>
              <td style={{ ...cell, whiteSpace: "nowrap" }}>
                {consultLabel(r)}
                {r.report?.visit_date && <div style={{ fontSize: 11.5 }}>受診 {r.report.visit_date}</div>}
              </td>
              <td style={{ ...cell, whiteSpace: "nowrap" }}>{interviewNeeded(r) ? "要" : "不要"}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={9} className="muted" style={{ textAlign: "center", padding: 20 }}>
                対象の健診結果がありません。
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p style={{ fontSize: 12, marginTop: 10 }}>※ {LEGAL_NOTE}</p>
      <div className="no-print">
        <PrintButton />
      </div>
    </div>
  );
}
