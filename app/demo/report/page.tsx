import Link from "next/link";
import ConsultReportForm from "@/components/ConsultReportForm";
import { DEMO_REPORT } from "@/lib/demo-data";

export const metadata = { title: "受診報告(デモ) | 健康管理Web" };

// 紹介用デモ: 受診勧奨通知書のQRコードを読み取ると開く受診報告ページ(本人のスマートフォンでの見え方)。
// 本人確認は何を入れても通り、送信しても保存されない
export default function DemoReportPage() {
  return (
    <main className="container" style={{ maxWidth: 560 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0 12px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" width={36} height={36} />
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>
            健康管理<span style={{ color: "var(--orange)" }}>Web</span>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>受診報告</div>
        </div>
      </div>
      <div className="notice" style={{ marginBottom: 12 }}>
        <strong>サンプル(デモ)</strong>: 受診勧奨通知書のQRコードを読み取ると、本人のスマートフォンにこの画面が開きます。
        架空の従業員「{DEMO_REPORT.target_name}」の例です。本人確認は何を入れても次へ進み、送信しても保存されません。
      </div>
      <ConsultReportForm token="demo" demoInfo={DEMO_REPORT} />
      <p className="muted" style={{ fontSize: 12, marginTop: 12, display: "flex", gap: 14 }}>
        <Link href="/demo/checkups/notices">← 通知書のデモに戻る</Link>
        <Link href="/privacy">個人情報の取扱いについて</Link>
      </p>
    </main>
  );
}
