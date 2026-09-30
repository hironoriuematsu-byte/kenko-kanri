/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    // 動的ページ(健診・面談などの内容)をブラウザ側に保持しない。
    // 保存後に画面を移動したとき古い内容が出ないようにするための再読み込み(router.refresh)が
    // 不要になり、保存から表示までの往復が1回減る
    staleTimes: { dynamic: 0 },
  },
};

export default nextConfig;
