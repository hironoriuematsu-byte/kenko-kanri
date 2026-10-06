"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Item = {
  company_id: string;
  company_name: string;
  participants: { name: string; since: string | null }[] | null;
};

// 産業医事務所ダッシュボード: 各企業の面談ルームに誰か待っているかを一覧表示(30秒ごとに更新)
export default function MeetRoomsOverview() {
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/meet/overview", { cache: "no-store" });
        if (res.ok) setItems((await res.json()).items);
      } catch {
        /* 前回の表示のまま */
      }
    };
    load();
    const timer = setInterval(() => document.visibilityState === "visible" && load(), 30_000);
    return () => clearInterval(timer);
  }, []);

  if (!items || items.length === 0) return null;
  const waiting = items.filter((i) => (i.participants?.length ?? 0) > 0);

  return (
    <div className="card" style={{ borderColor: waiting.length > 0 ? "var(--teal)" : undefined }}>
      <h2>産業医面談ルーム</h2>
      {waiting.length > 0 && (
        <p>
          <span className="badge">● {waiting.length}件のルームに入室者がいます</span>
        </p>
      )}
      <div className="card-grid">
        {items.map((i) => {
          const n = i.participants?.length ?? 0;
          return (
            <Link
              key={i.company_id}
              href={`/office/${i.company_id}/meet`}
              className="card"
              style={{ marginBottom: 0, borderColor: n > 0 ? "var(--teal)" : undefined }}
            >
              <strong>{i.company_name}</strong>
              <div className="muted">
                {i.participants === null
                  ? "在室状況：表示なし"
                  : n > 0
                    ? `入室中：${i.participants.map((p) => p.name).join("、")}`
                    : "空室"}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
