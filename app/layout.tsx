import type { Metadata } from "next";
import "./globals.css";
import DomSafety from "@/components/DomSafety";

export const metadata: Metadata = {
  title: "健康管理Web | うえまつ産業医事務所",
  description: "産業保健活動の統合管理システム",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <DomSafety />
        {children}
        <footer className="site-footer no-print">
          &copy; {new Date().getFullYear()} うえまつ産業医事務所 (Mestate LLC)
        </footer>
      </body>
    </html>
  );
}
