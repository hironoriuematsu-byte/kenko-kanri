import Link from "next/link";

export type MenuItem = {
  href: string;
  title: string;
  desc: string;
  icon: string;
};

// 事業所メニュー(アイコン+説明文つきカード)。ストレスチェックWebと同テイスト
export default function MenuGrid({ items }: { items: MenuItem[] }) {
  return (
    <div className="card-grid" style={{ marginTop: 18 }}>
      {items.map((m) => (
        <Link key={m.href} href={m.href} className="card menu-card">
          <span className="menu-icon" aria-hidden>
            {m.icon}
          </span>
          <span>
            <strong>{m.title}</strong>
            <span className="menu-desc">{m.desc}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}
