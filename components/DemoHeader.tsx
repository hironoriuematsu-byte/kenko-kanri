import Link from "next/link";

// 紹介用デモのヘッダー(ログイン不要。通常のヘッダーはログイン中の利用者情報が必要なため別にする)
export default function DemoHeader() {
  const stressUrl = process.env.NEXT_PUBLIC_STRESS_URL;
  return (
    <header className="site-header no-print">
      <div className="inner">
        <Link href="/demo" className="brand" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="mestate うえまつ産業医事務所"
            style={{ height: 46, width: "auto", display: "block" }}
          />
          <span style={{ fontSize: 20, fontWeight: 800 }}>
            健康管理<span style={{ color: "var(--orange)" }}>Web</span>
          </span>
          <span className="badge orange" style={{ marginLeft: 4 }}>
            サンプル(デモ)
          </span>
        </Link>
        <div className="header-right">
          {stressUrl && (
            <a href={`${stressUrl}/demo`} target="_blank" rel="noopener noreferrer">
              ストレスチェックWebのデモ ↗
            </a>
          )}
          <Link href="/demo">デモの目次</Link>
          <Link href="/login">ログイン</Link>
        </div>
      </div>
    </header>
  );
}
