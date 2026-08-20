"use client";

import { useEffect, useState } from "react";
import { normalizeDate } from "@/lib/checkups";

// 生年月日など、カレンダーから選ぶより直接入力したい日付用の入力欄。
// 「1975/4/1」「1975-04-01」「19750401」などを受け付けて YYYY-MM-DD に正規化する。
export default function DateTextInput({
  value,
  onChange,
  id,
  required,
  style,
}: {
  value: string; // YYYY-MM-DD
  onChange: (v: string) => void;
  id?: string;
  required?: boolean;
  style?: React.CSSProperties;
}) {
  const toDisplay = (v: string) => (v ? v.replace(/-/g, "/") : "");
  const [text, setText] = useState(toDisplay(value));
  const [error, setError] = useState(false);

  // 外部から値が変わった場合(編集画面の初期表示など)に追従する
  useEffect(() => {
    setText(toDisplay(value));
  }, [value]);

  const commit = (raw: string) => {
    const t = raw.trim();
    if (!t) {
      setError(false);
      onChange("");
      return;
    }
    const normalized = normalizeDate(t);
    if (normalized) {
      setError(false);
      setText(toDisplay(normalized));
      onChange(normalized);
    } else {
      setError(true);
    }
  };

  return (
    <>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit((e.target as HTMLInputElement).value);
          }
        }}
        placeholder="例: 1975/4/1"
        required={required}
        style={{ width: 160, ...style }}
      />
      {error && (
        <span className="error-message" style={{ marginLeft: 8 }}>
          日付の形式を確認してください（例: 1975/4/1）
        </span>
      )}
    </>
  );
}
