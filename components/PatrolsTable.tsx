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
              <Link href={`/patrols/${p.id}`}>{formatDateJa(p.patrol_date)}</Link>
            </td>
            <td className="muted">{excerpt(combinePatrolText(p)) || "—"}</td>
            <td>{p.physician_name || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
