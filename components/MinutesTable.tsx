import Link from "next/link";
import { formatDateJa } from "@/lib/fiscal";

type Row = {
  id: string;
  meeting_date: string;
  title: string;
  physician_attended: boolean;
  published_to_employees: boolean;
};

export default function MinutesTable({ minutes }: { minutes: Row[] }) {
  if (minutes.length === 0) {
    return <p className="muted">議事録はまだありません。</p>;
  }
  return (
    <table className="list">
      <thead>
        <tr>
          <th>開催日</th>
          <th>件名</th>
          <th>産業医出席</th>
          <th>従業員公開</th>
        </tr>
      </thead>
      <tbody>
        {minutes.map((m) => (
          <tr key={m.id}>
            <td>
              <Link href={`/minutes/${m.id}`}>{formatDateJa(m.meeting_date)}</Link>
            </td>
            <td>{m.title}</td>
            <td>{m.physician_attended ? <span className="badge">出席</span> : "—"}</td>
            <td>{m.published_to_employees ? <span className="badge orange">公開中</span> : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
