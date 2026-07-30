import Link from "next/link";
import {
  INTERVIEW_TYPES,
  INTERVIEW_METHODS,
  INTERVIEW_STATUS,
  formatDateTimeJa,
} from "@/lib/interviews";

type Row = {
  id: string;
  target_name: string;
  interview_type: string;
  scheduled_at: string | null;
  method: string | null;
  status: string;
};

export default function InterviewsTable({
  interviews,
  showTarget = true,
}: {
  interviews: Row[];
  showTarget?: boolean;
}) {
  if (interviews.length === 0) {
    return <p className="muted">面談はまだ登録されていません。</p>;
  }
  return (
    <table className="list">
      <thead>
        <tr>
          <th>予定日時</th>
          {showTarget && <th>対象者</th>}
          <th>種別</th>
          <th>方法</th>
          <th>状態</th>
        </tr>
      </thead>
      <tbody>
        {interviews.map((i) => (
          <tr key={i.id}>
            <td>
              <Link href={`/interviews/${i.id}`}>{formatDateTimeJa(i.scheduled_at)}</Link>
            </td>
            {showTarget && <td>{i.target_name}</td>}
            <td>{INTERVIEW_TYPES[i.interview_type] ?? i.interview_type}</td>
            <td>{i.method ? INTERVIEW_METHODS[i.method] : "—"}</td>
            <td>
              {i.status === "scheduled" ? (
                <span className="badge">{INTERVIEW_STATUS[i.status]}</span>
              ) : i.status === "done" ? (
                <span className="badge orange">{INTERVIEW_STATUS[i.status]}</span>
              ) : (
                <span className="muted">{INTERVIEW_STATUS[i.status]}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
