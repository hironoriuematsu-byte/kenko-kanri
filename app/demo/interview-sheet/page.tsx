import Link from "next/link";
import { notFound } from "next/navigation";
import DemoHeader from "@/components/DemoHeader";
import DemoNotice from "../DemoNotice";
import PrintButton from "@/components/PrintButton";
import { DEMO_COMPANY, DEMO_PHYSICIAN, demoInterview } from "@/lib/demo-data";
import { INTERVIEW_TYPES, WORK_JUDGMENTS } from "@/lib/interviews";
import { formatDateJa } from "@/lib/fiscal";

export const metadata = { title: "面談結果報告・意見書(デモ) | 健康管理Web" };

// 紹介用デモ: 企業にお渡しする意見書の印刷様式(実際の画面と同じ構成)
export default function DemoInterviewSheetPage({ searchParams }: { searchParams: { id?: string } }) {
  const iv = demoInterview(searchParams.id ?? "i1");
  if (!iv || !iv.opinion) notFound();
  const opinion = iv.opinion;

  return (
    <>
      <DemoHeader />
      <main className="container">
        <p className="muted no-print">
          <Link href={`/demo/interviews/${iv.id}`}>← 面談詳細に戻る</Link>
        </p>
        <DemoNotice />

        <div className="card print-sheet">
          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <h1 style={{ fontSize: 20, margin: 0 }}>面談結果報告・意見書</h1>
          </div>

          <p>{DEMO_COMPANY} 御中</p>

          <table className="list" style={{ marginBottom: 16 }}>
            <tbody>
              <tr>
                <th style={{ width: 160 }}>対象者氏名</th>
                <td>{iv.target_name}</td>
              </tr>
              <tr>
                <th>面談種別</th>
                <td>{INTERVIEW_TYPES[iv.interview_type] ?? iv.interview_type}</td>
              </tr>
              <tr>
                <th>面談実施日</th>
                <td>{formatDateJa(opinion.interview_date)}</td>
              </tr>
              <tr>
                <th>就業区分の判定</th>
                <td>
                  <strong>{WORK_JUDGMENTS[opinion.work_judgment]}</strong>
                </td>
              </tr>
              <tr>
                <th>就業上の措置に関する意見</th>
                <td style={{ whiteSpace: "pre-wrap" }}>{opinion.opinion}</td>
              </tr>
            </tbody>
          </table>

          <div style={{ textAlign: "right", marginTop: 24 }}>
            <div>発行日: {formatDateJa(opinion.issued_date)}</div>
            <div style={{ marginTop: 8 }}>うえまつ産業医事務所　産業医　{DEMO_PHYSICIAN}</div>
          </div>

          <div className="no-print" style={{ marginTop: 18 }}>
            <PrintButton />
          </div>
        </div>
      </main>
    </>
  );
}
