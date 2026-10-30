import type { Metadata } from "next";

// ログイン画面は検索結果に出さない(契約企業の方はURLから直接アクセスする)。
// page.tsx はクライアントコンポーネントで metadata を書けないため、レイアウトで指定する
export const metadata: Metadata = {
  title: "ログイン | 健康管理Web",
  robots: { index: false, follow: false },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
