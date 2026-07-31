"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type PersonRow = {
  id: string;
  full_name: string;
  kana: string | null;
  employee_no: string | null;
  department: string | null;
};

// 検索用の正規化: 空白除去・小文字化・ひらがな→カタカナ
function normalize(s: string): string {
  return s
    .replace(/[\s　]/g, "")
    .toLowerCase()
    .replace(/[ぁ-ん]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}

export default function PersonsTable({ persons }: { persons: PersonRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (!q) return persons;
    return persons.filter((p) =>
      [p.full_name, p.kana, p.employee_no, p.department]
        .filter(Boolean)
        .some((v) => normalize(v as string).includes(q))
    );
  }, [persons, query]);

  return (
    <div>
      <div className="form-row" style={{ maxWidth: 340 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="氏名・フリガナ・社員番号・部署で検索"
          aria-label="従業員検索"
        />
      </div>

      {persons.length === 0 ? (
        <p className="muted">
          従業員はまだ登録されていません。「＋ 従業員を登録」からカルテを作成してください。
        </p>
      ) : filtered.length === 0 ? (
        <p className="muted">「{query}」に一致する従業員は見つかりませんでした。</p>
      ) : (
        <>
          {query && (
            <p className="muted">
              {filtered.length}名が一致（全{persons.length}名）
            </p>
          )}
          <table className="list">
            <thead>
              <tr>
                <th>社員番号</th>
                <th>氏名</th>
                <th>フリガナ</th>
                <th>部署</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td>{p.employee_no || "—"}</td>
                  <td>
                    <Link href={`/karte/${p.id}`}>{p.full_name}</Link>
                  </td>
                  <td className="muted">{p.kana ?? ""}</td>
                  <td>{p.department ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
