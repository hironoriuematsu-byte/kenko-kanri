import type { CheckupRow } from "@/components/CheckupsTable";
import { summarize } from "@/lib/workJudgmentReport";

const num: React.CSSProperties = { textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };

// 就業判定と事後措置の人数(健康診断管理の集計の横と、就業判定・事後措置報告書で共通)
export default function WorkJudgmentSummary({ rows }: { rows: CheckupRow[] }) {
  const s = summarize(rows);
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
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
  );
}
