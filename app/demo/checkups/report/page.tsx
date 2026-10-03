import Link from "next/link";
import DemoHeader from "@/components/DemoHeader";
import DemoNotice from "../../DemoNotice";
import Form6Sheet from "@/components/Form6Sheet";
import { DEMO_COMPANY, DEMO_FISCAL_YEAR, DEMO_OFFICE, demoCheckups } from "@/lib/demo-data";
import { computeCheckupStats } from "@/lib/checkupList";

export const metadata = { title: "労基署報告(デモ) | 健康管理Web" };

// 紹介用デモ: 労基署報告(様式第6号)の転記用集計(印刷/PDF保存できる画面)
export default function DemoCheckupReportPage() {
  const { rows, items } = demoCheckups();
  const { stats, form6 } = computeCheckupStats(rows, items);
  return (
    <>
      <DemoHeader />
      <main className="container">
        <p className="muted no-print">
          <Link href="/demo/checkups">← 健康診断管理に戻る</Link>
        </p>
        <DemoNotice />
        <div className="card">
          <Form6Sheet variant="sheet" companyName={DEMO_COMPANY} fiscalYear={DEMO_FISCAL_YEAR} stats={stats} form6={form6} officeInfo={DEMO_OFFICE} />
        </div>
      </main>
    </>
  );
}
