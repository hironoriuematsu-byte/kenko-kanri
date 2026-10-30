import Link from "next/link";

// 健診結果の医師意見聴取Web(50人未満向け)の公開ページ共通の枠(ログイン不要)
export const metadata = {
  title: "健診結果の医師意見聴取Web(50人未満の事業場向け) | うえまつ産業医事務所",
  description:
    "産業医がいない50人未満の事業場向けに、健康診断結果についての医師の意見聴取(就業判定)をWebで。健診結果を送るだけで、産業医が3営業日以内にお返しします。1件550円(税込)。",
};

export default function IkenLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="site-header no-print">
        <div className="inner">
          <Link href="/iken" className="brand" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="mestate うえまつ産業医事務所" style={{ height: 46, width: "auto", display: "block" }} />
            <span style={{ fontSize: 18, fontWeight: 800 }}>
              医師意見聴取<span style={{ color: "var(--orange)" }}>Web</span>
            </span>
          </Link>
          <div className="header-right">
            <Link href="/login">ログイン</Link>
          </div>
        </div>
      </header>
      <main className="container">{children}</main>
      <div className="container" style={{ paddingTop: 0, paddingBottom: 16, fontSize: 13 }}>
        <Link href="/iken/terms">利用規約</Link>
        <span className="muted" style={{ margin: "0 8px" }}>|</span>
        <Link href="/iken/tokushoho">特定商取引法に基づく表記</Link>
      </div>
    </>
  );
}
