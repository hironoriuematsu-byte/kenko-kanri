import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import DomSafety from "@/components/DomSafety";
import NavigationProgress from "@/components/NavigationProgress";

export const metadata: Metadata = {
  title: "健康管理Web | うえまつ産業医事務所",
  description: "産業保健活動の統合管理システム",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <DomSafety />
        {/* 画面切り替え中の進行バー(useSearchParams を使うため Suspense で包む) */}
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        {children}
        <footer className="site-footer no-print">
          <a href="/privacy" style={{ color: "inherit", textDecoration: "underline" }}>
            個人情報の取扱いについて
          </a>
          <span style={{ margin: "0 10px" }}>|</span>
          &copy; {new Date().getFullYear()} うえまつ産業医事務所 (Mestate LLC)
        </footer>
      </body>
    </html>
  );
}
