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
  // 空白(半角・全角)・全角/半角・大文字/小文字の違いは無視して探す
  const key = (v: string) => v.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  const q = key(query);
  const filtered = q
    ? companies.filter((c) => key(c.name).includes(q))
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
