"use client";

import Link from "next/link";
import { useState } from "react";

// 産業医事務所ダッシュボードの企業一覧(企業名で絞り込める)
export default function CompanyList({
  companies,
  badges = {},
}: {
  companies: { id: string; name: string }[];
  badges?: Record<string, number>; // 就業判定が必要な人数(未入力+判定保留)。0の企業には出さない
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q
    ? companies.filter((c) => c.name.toLowerCase().includes(q))
    : companies;

  return (
    <>
      <input
        type="search"
        placeholder="企業名で検索"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ width: "100%", maxWidth: 360, marginBottom: 12 }}
      />
      {filtered.length > 0 ? (
        <div className="company-grid">
          {filtered.map((c) => (
            <Link key={c.id} href={`/office/${c.id}`} className="company-tile">
              {c.name}
              {badges[c.id] > 0 && (
                <span className="company-tile-badge" title="就業判定が必要な健診結果">
                  判定 {badges[c.id]}名
                </span>
              )}
            </Link>
          ))}
        </div>
      ) : (
        <p className="muted">「{query}」に一致する企業はありません。</p>
      )}
    </>
  );
}
