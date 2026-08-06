import Link from "next/link";
import { formatDateJa } from "@/lib/fiscal";
import { CHECKLIST_TYPES, type ChecklistResult } from "@/lib/hygiene";

type Row = {
  id: string;
  patrol_date: string;
  checklist_type: string;
  inspector_name: string | null;
  results: ChecklistResult[];
};

export default function HygienePatrolsTable({ patrols }: { patrols: Row[] }) {
  if (patrols.length === 0) {
    return <p className="muted">巡視記録はまだありません。</p>;
  }
  return (
    <table className="list">
      <thead>
        <tr>
          <th>巡視日</th>
          <th>種別</th>
          <th>巡視者</th>
          <th>要改善</th>
        </tr>
      </thead>
      <tbody>
        {patrols.map((p) => {
          const ngCount = (p.results ?? []).filter((r) => r.result === "ng").length;
          return (
            <tr key={p.id}>
              <td>
                <Link href={`/hygiene-patrols/${p.id}`}>{formatDateJa(p.patrol_date)}</Link>
              </td>
              <td>{CHECKLIST_TYPES[p.checklist_type] ?? p.checklist_type}</td>
              <td>{p.inspector_name || "—"}</td>
              <td>
                {ngCount > 0 ? <span className="badge orange">{ngCount}件</span> : "—"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
