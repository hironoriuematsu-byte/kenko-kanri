import Link from "next/link";
import DemoHeader from "@/components/DemoHeader";
import DemoNotice from "../DemoNotice";
import InterviewsTable from "@/components/InterviewsTable";
import { DEMO_COMPANY, DEMO_INTERVIEWS } from "@/lib/demo-data";

export const metadata = { title: "産業医面談管理(デモ) | 健康管理Web" };

// 紹介用デモ: 産業医面談の一覧(面談日を押すと詳細へ)
export default function DemoInterviewsPage() {
  return (
    <>
      <DemoHeader />
      <main className="container">
        <p className="muted">
          <Link href="/demo">← デモの目次</Link>
        </p>
        <h1 className="page-title">{DEMO_COMPANY} — 産業医面談管理</h1>
        <DemoNotice />
        <div className="card">
          <p style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span className="btn orange" aria-disabled style={{ opacity: 0.6, cursor: "default" }}>＋ 面談予定を登録</span>
          </p>
          <p className="muted" style={{ fontSize: 12.5 }}>
            面談日を押すと、事前情報・実施記録・意見書のある詳細画面が開きます。実施済の面談には企業にお渡しする意見書があります。
          </p>
          <InterviewsTable
            interviews={DEMO_INTERVIEWS.map((i) => ({
              id: i.id,
              target_name: i.target_name,
              interview_type: i.interview_type,
              scheduled_at: i.scheduled_at,
              method: i.method,
              status: i.status,
            }))}
            hrefFor={(id) => `/demo/interviews/${id}`}
          />
        </div>
      </main>
    </>
  );
}
