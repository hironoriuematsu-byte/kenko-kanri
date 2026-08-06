import { formatDateJa } from "@/lib/fiscal";
import { CHECKLIST_TYPES, RESULT_LABELS, type ChecklistResult } from "@/lib/hygiene";

// 衛生管理者巡視記録1件分の帳票表示(まとめ印刷用)
export default function HygienePatrolSheet({
  patrol,
  companyName,
}: {
  patrol: {
    patrol_date: string;
    checklist_type: string;
    inspector_name: string | null;
    results: ChecklistResult[];
    summary: string | null;
  };
  companyName: string;
}) {
  const results = patrol.results ?? [];
  const ngCount = results.filter((r) => r.result === "ng").length;

  return (
    <div className="print-sheet" style={{ marginBottom: 24 }}>
      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <h2 style={{ fontSize: 18, margin: 0, border: "none", padding: 0, color: "var(--ink)" }}>
          衛生管理者職場巡視記録
        </h2>
        <div className="muted">{companyName}</div>
      </div>

      <table className="list" style={{ marginBottom: 10 }}>
        <tbody>
          <tr>
            <th style={{ width: 130 }}>巡視日</th>
            <td>{formatDateJa(patrol.patrol_date)}</td>
            <th style={{ width: 130 }}>種別</th>
            <td>{CHECKLIST_TYPES[patrol.checklist_type] ?? patrol.checklist_type}</td>
          </tr>
          <tr>
            <th>巡視者</th>
            <td>{patrol.inspector_name || "—"}</td>
            <th>要改善</th>
            <td>{ngCount > 0 ? `${ngCount}件` : "なし"}</td>
          </tr>
        </tbody>
      </table>

      <table className="list" style={{ marginBottom: 10 }}>
        <thead>
          <tr>
            <th>点検項目</th>
            <th style={{ width: 90 }}>判定</th>
            <th style={{ width: "30%" }}>メモ</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => (
            <tr key={i}>
              <td>{r.item}</td>
              <td>
                {r.result === "ng" ? (
                  <strong style={{ color: "var(--danger)" }}>{RESULT_LABELS[r.result]}</strong>
                ) : (
                  RESULT_LABELS[r.result] ?? r.result
                )}
              </td>
              <td>{r.note || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {patrol.summary && (
        <table className="list">
          <tbody>
            <tr>
              <th style={{ width: 130 }}>特記事項・改善指示</th>
              <td style={{ whiteSpace: "pre-wrap" }}>{patrol.summary}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
