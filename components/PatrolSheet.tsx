import { formatDateJa } from "@/lib/fiscal";
import { combinePatrolText } from "@/lib/patrols";

// 産業医巡視記録1件分の帳票表示(年度まとめ印刷用)
export default function PatrolSheet({
  patrol,
  companyName,
}: {
  patrol: {
    patrol_date: string;
    areas: string | null;
    findings: string | null;
    advice: string | null;
    note: string | null;
    physician_name: string | null;
  };
  companyName: string;
}) {
  return (
    <div className="print-sheet">
      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <h2 style={{ fontSize: 18, margin: 0, border: "none", padding: 0, color: "var(--ink)" }}>
          産業医職場巡視記録
        </h2>
        <div className="muted">{companyName}</div>
      </div>

      <table className="list">
        <tbody>
          <tr>
            <th style={{ width: 150 }}>巡視日</th>
            <td>{formatDateJa(patrol.patrol_date)}</td>
          </tr>
          <tr>
            <th>指摘事項等</th>
            <td style={{ whiteSpace: "pre-wrap" }}>{combinePatrolText(patrol) || "—"}</td>
          </tr>
          <tr>
            <th>産業医</th>
            <td>{patrol.physician_name || "—"}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
