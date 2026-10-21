import Link from "next/link";
import { formatDateJa } from "@/lib/fiscal";
import { combinePatrolText } from "@/lib/patrols";

type Row = {
  id: string;
  patrol_date: string;
  areas: string | null;
  findings: string | null;
  advice: string | null;
  note: string | null;
  physician_name: string | null;
};

// 巡視日を「2026年」と「10月21日」の2行で表示する(スマートフォンで途中で折り返さないように)
function DateTwoLines({ date }: { date: string }) {
  const s = formatDateJa(date);
  const i = s.indexOf("年");
  if (i < 0) return <>{s}</>;
  return (
    <>
      <span style={{ whiteSpace: "nowrap" }}>{s.slice(0, i + 1)}</span>
      <br />
      <span style={{ whiteSpace: "nowrap" }}>{s.slice(i + 1)}</span>
    </>
  );
}

function excerpt(s: string, len = 40): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > len ? t.slice(0, len) + "…" : t;
}

export default function PatrolsTable({ patrols }: { patrols: Row[] }) {
  if (patrols.length === 0) {
    return <p className="muted">巡視記録はまだありません。</p>;
  }
  return (
    <table className="list">
      <thead>
        <tr>
          <th>巡視日</th>
          <th>指摘事項等</th>
          <th>産業医</th>
        </tr>
      </thead>
      <tbody>
        {patrols.map((p) => (
          <tr key={p.id}>
            <td>
              <Link href={`/patrols/${p.id}`}>
                <DateTwoLines date={p.patrol_date} />
              </Link>
            </td>
            <td className="muted">{excerpt(combinePatrolText(p)) || "—"}</td>
            <td style={{ whiteSpace: "nowrap" }}>{p.physician_name || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
