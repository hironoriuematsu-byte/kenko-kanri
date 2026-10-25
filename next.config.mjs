// ブラウザ向けの防御設定(セキュリティヘッダー)。すべてのページ・APIに付ける
//   - 他のサイトに画面を埋め込ませない(なりすまし画面・クリックジャッキング対策)
//   - 読み込んでよい場所を自サイトとデータベース(Supabase)に限る(不正なプログラムの読み込み・データの持ち出し対策)
//   - 常に暗号化通信(https)を使わせる
// Next.js が画面の表示に使う埋め込みのプログラムがあるため、script-src は 'unsafe-inline' を許可している
const supabase = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
  } catch {
    return "https://*.supabase.co";
  }
})();
const dev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${supabase}`, // 巡視写真などは Supabase の一時URLで表示する
  "font-src 'self' data:",
  `connect-src 'self' ${supabase} ${supabase.replace(/^https:/, "wss:")}`,
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  ...(dev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // 音声入力にマイクを使う(自サイトのみ)。カメラ・位置情報などは使わない(写真はファイル選択から)
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    // 動的ページ(健診・面談などの内容)をブラウザ側に保持しない。
    // 保存後に画面を移動したとき古い内容が出ないようにするための再読み込み(router.refresh)が
    // 不要になり、保存から表示までの往復が1回減る
    staleTimes: { dynamic: 0 },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
