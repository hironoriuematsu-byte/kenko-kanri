import Link from "next/link";
import { formatDateJa } from "@/lib/fiscal";

type Row = {
  id: string;
  patrol_date: string;
  areas: string | null;
  physician_name: string | null;
};

export default function PatrolsTable({ patrols }: { patrols: Row[] }) {
  if (patrols.length === 0) {
    return <p className="muted">巡視記録はまだありません。</p>;
  }
  return (
    <table className="list">
      <thead>
        <tr>
          <th>巡視日</th>
          <th>巡視場所</th>
          <th>産業医</th>
        </tr>
      </thead>
      <tbody>
        {patrols.map((p) => (
          <tr key={p.id}>
            <td>
              <Link href={`/patrols/${p.id}`}>{formatDateJa(p.patrol_date)}</Link>
            </td>
            <td>{p.areas || "—"}</td>
            <td>{p.physician_name || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
