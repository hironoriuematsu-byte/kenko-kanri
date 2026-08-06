import { formatDateJa } from "@/lib/fiscal";

// 議事録1件分の帳票表示(年度まとめ印刷用)
export default function MinutesSheet({
  minutes,
  companyName,
}: {
  minutes: {
    meeting_date: string;
    title: string;
    attendees: string | null;
    agenda: string | null;
  };
  companyName: string;
}) {
  return (
    <div className="print-sheet">
      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <h2 style={{ fontSize: 18, margin: 0, border: "none", padding: 0, color: "var(--ink)" }}>
          {minutes.title}　議事録
        </h2>
        <div className="muted">{companyName}</div>
      </div>

      <table className="list">
        <tbody>
          <tr>
            <th style={{ width: 150 }}>開催日</th>
            <td>{formatDateJa(minutes.meeting_date)}</td>
          </tr>
          <tr>
            <th>出席者</th>
            <td style={{ whiteSpace: "pre-wrap" }}>{minutes.attendees || "—"}</td>
          </tr>
          <tr>
            <th>審議事項</th>
            <td style={{ whiteSpace: "pre-wrap" }}>{minutes.agenda || "—"}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
