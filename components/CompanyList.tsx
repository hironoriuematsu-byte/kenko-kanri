"use client";

import Link from "next/link";
import { useState } from "react";

// 産業医事務所ダッシュボードの企業一覧(企業名で絞り込める)
export default function CompanyList({
  companies,
}: {
  companies: { id: string; name: string }[];
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
            </Link>
          ))}
        </div>
      ) : (
        <p className="muted">「{query}」に一致する企業はありません。</p>
      )}
    </>
  );
}
