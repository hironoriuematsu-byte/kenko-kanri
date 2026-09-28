"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { INTERVIEW_TYPES, formatDateTimeJa } from "@/lib/interviews";

export type ScheduleItem = {
  id: string;
  target_name: string;
  interview_type: string;
  scheduled_at: string | null;
  company_name: string | null;
  overdue: boolean; // 予定日を過ぎて未実施
};

// 日付キー(ローカル日付。未定は "")
function dayKey(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ダッシュボードの面談予定一覧。
//   日付を押す → その日の面談予定者(氏名・企業)の一覧を表示
//   氏名を押す → 面談の詳細ページへ
export default function InterviewSchedule({ items }: { items: ScheduleItem[] }) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const byDay = useMemo(() => {
    const m = new Map<string, ScheduleItem[]>();
    for (const it of items) {
      const k = dayKey(it.scheduled_at);
      m.set(k, [...(m.get(k) ?? []), it]);
    }
    return m;
  }, [items]);

  const selectedItems = selectedDay === null ? [] : (byDay.get(selectedDay) ?? []);
  const selectedLabel =
    selectedDay === null ? "" : selectedDay === "" ? "日付未定" : formatDateTimeJa(selectedItems[0]?.scheduled_at ?? null);

  const linkBtn: React.CSSProperties = {
    background: "none",
    border: "none",
    padding: 0,
    font: "inherit",
    color: "var(--teal-dark, #0B6B62)",
    cursor: "pointer",
    textDecoration: "underline",
  };

  return (
    <>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        日付を押すとその日の面談予定者の一覧が開きます。氏名を押すと面談の詳細に移動します。
      </p>
      <table className="list">
        <thead>
          <tr>
            <th>予定日</th>
            <th>企業</th>
            <th>対象者</th>
            <th>種別</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => {
            const k = dayKey(i.scheduled_at);
            const active = selectedDay === k;
            return (
              <tr key={i.id} style={active ? { background: "#F1F8F7" } : undefined}>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button
                    type="button"
                    style={{ ...linkBtn, fontWeight: active ? 700 : 400 }}
                    onClick={() => setSelectedDay(active ? null : k)}
                    title="この日の面談予定者を表示"
                  >
                    {formatDateTimeJa(i.scheduled_at)}
                  </button>
                  {i.overdue && (
                    <span className="badge orange" style={{ marginLeft: 6 }}>
                      未実施
                    </span>
                  )}
                </td>
                <td>{i.company_name ?? "—"}</td>
                <td>
                  <Link href={`/interviews/${i.id}`}>{i.target_name}</Link>
                </td>
                <td>{INTERVIEW_TYPES[i.interview_type] ?? i.interview_type}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {selectedDay !== null && (
        <div
          style={{
            marginTop: 12,
            border: "1px solid var(--teal, #0F9B8E)",
            borderRadius: 10,
            padding: "10px 14px",
            background: "#F7FBFA",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <strong>
              {selectedLabel} の面談予定（{selectedItems.length}件）
            </strong>
            <button type="button" className="btn secondary" style={{ padding: "3px 10px", fontSize: 12 }} onClick={() => setSelectedDay(null)}>
              閉じる
            </button>
          </div>
          <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
            {selectedItems.map((i) => (
              <li key={i.id} style={{ margin: "4px 0" }}>
                <Link href={`/interviews/${i.id}`} style={{ fontWeight: 700 }}>
                  {i.target_name}
                </Link>
                <span className="muted" style={{ marginLeft: 8 }}>
                  {i.company_name ?? "—"}
                  {" / "}
                  {INTERVIEW_TYPES[i.interview_type] ?? i.interview_type}
                </span>
                {i.overdue && (
                  <span className="badge orange" style={{ marginLeft: 6 }}>
                    未実施
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
