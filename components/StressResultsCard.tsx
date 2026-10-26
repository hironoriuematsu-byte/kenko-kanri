import { formatDateJa } from "@/lib/fiscal";

// 面接指導を申し出た人のストレスチェック結果(ストレスチェックWebの結果を読み取って表示する)
//   実施者: 申出に結びつく結果すべて / 事業者担当者: 本人が会社への結果の提供に同意している結果だけ(RPC側で絞る)
export type RequestedStressResult = {
  interview_request_id: string;
  requested_at: string;
  request_status: string;
  result_id: string;
  fiscal_year: number;
  examined_at: string;
  questionnaire: string;
  score_a: number;
  score_b: number;
  score_c: number;
  high_stress: boolean;
};

const REQUEST_STATUS: Record<string, string> = { pending: "申出受付", scheduled: "日程調整済", done: "実施済", cancelled: "取消" };

export default function StressResultsCard({
  rows,
  showReportLink,
  title = "ストレスチェック結果(面接指導の申出)",
}: {
  rows: RequestedStressResult[];
  showReportLink: boolean;
  title?: string;
}) {
  if (rows.length === 0) return null;
  const stressUrl = process.env.NEXT_PUBLIC_STRESS_URL;
  return (
    <div className="card">
      <h2>{title}</h2>
      <div style={{ overflowX: "auto" }}>
        <table className="list">
          <thead>
            <tr>
              <th>年度</th>
              <th>受検日</th>
              <th>判定</th>
              <th style={{ whiteSpace: "nowrap" }}>A 仕事のストレス要因</th>
              <th style={{ whiteSpace: "nowrap" }}>B 心身のストレス反応</th>
              <th style={{ whiteSpace: "nowrap" }}>C 周囲のサポート</th>
              <th>申出</th>
              {showReportLink && stressUrl && <th>結果票</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.interview_request_id}>
                <td style={{ whiteSpace: "nowrap" }}>{r.fiscal_year}年度</td>
                <td style={{ whiteSpace: "nowrap" }}>{formatDateJa(r.examined_at.slice(0, 10))}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <span className={r.high_stress ? "badge orange" : "badge"}>{r.high_stress ? "高ストレス" : "高ストレスに該当せず"}</span>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>{r.score_a}点 / 68</td>
                <td style={{ whiteSpace: "nowrap" }}>{r.score_b}点 / 116</td>
                <td style={{ whiteSpace: "nowrap" }}>{r.score_c}点 / 36</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {formatDateJa(r.requested_at.slice(0, 10))}({REQUEST_STATUS[r.request_status] ?? r.request_status})
                </td>
                {showReportLink && stressUrl && (
                  <td style={{ whiteSpace: "nowrap" }}>
                    <a href={`${stressUrl}/report/${r.result_id}`} target="_blank" rel="noopener noreferrer">
                      開く
                    </a>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: 8 }}>
        合計点数法(職業性ストレス簡易調査票{rows[0].questionnaire === "80" ? "・80項目版" : "57項目版"})。A・B は点数が高いほどストレスが高く、C は点数が高いほど周囲のサポートが乏しい状態です。
        高ストレスの判定基準: ① B が77点以上、または ② A+C が76点以上かつ B が63点以上。
        面接指導の申出により、本人は会社への結果の提供に同意したものとみなされます。
      </p>
    </div>
  );
}
