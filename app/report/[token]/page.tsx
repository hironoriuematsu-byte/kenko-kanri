import Link from "next/link";
import ConsultReportForm from "@/components/ConsultReportForm";

export const dynamic = "force-dynamic";

// 受診勧奨通知のQRコードから開く受診報告ページ(ログイン不要)
export default function ConsultReportPage({ params }: { params: { token: string } }) {
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
      <ConsultReportForm token={params.token} />
      <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
        <Link href="/privacy">個人情報の取扱いについて</Link>
      </p>
    </main>
  );
}
