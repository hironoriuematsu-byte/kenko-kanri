"use client";

import { useState } from "react";
import Link from "next/link";
import { formatYen, MIN_SEATS, MIN_TOTAL, priceAdd, priceNew, UNIT_PRICE, WEB_MAX_SEATS } from "@/lib/iken";

// 年度の申込・件数の追加(担当者)。Stripe の決済画面へ進む
export default function IkenOrderForm({
  years,
  seatsByYear,
  defaultSeats,
}: {
  years: number[];
  seatsByYear: Record<number, number>;
  defaultSeats: number;
}) {
  const [year, setYear] = useState(years[0]);
  const [seats, setSeats] = useState(String(defaultSeats));
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasPlan = (seatsByYear[year] ?? 0) > 0;
  const n = Number(seats.normalize("NFKC"));
  const valid = Number.isInteger(n) && n >= 1 && n <= WEB_MAX_SEATS;
  const price = valid ? (hasPlan ? priceAdd(n) : priceNew(n)) : null;

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/iken/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: hasPlan ? "add" : "new", fiscalYear: year, seats: n, agreeTerms: agree }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.url) {
        setError(json.error ?? "決済画面を開けませんでした。");
        setBusy(false);
        return;
      }
      window.location.href = json.url;
    } catch {
      setError("通信できませんでした。もう一度お試しください。");
      setBusy(false);
    }
  };

  return (
    <div>
      {years.length > 1 && (
        <div className="form-row">
          <label htmlFor="iken-year">年度</label>
          <select id="iken-year" value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ maxWidth: 220 }}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}年度({y}年4月〜{y + 1}年3月)
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="form-row">
        <label htmlFor="iken-seats">{hasPlan ? "追加する件数" : "健診結果の件数(人数)"}</label>
        <input
          id="iken-seats"
          type="number"
          min={1}
          max={WEB_MAX_SEATS}
          value={seats}
          onChange={(e) => setSeats(e.target.value)}
          style={{ maxWidth: 160 }}
        />
        <div className="muted">
          {hasPlan
            ? `1件 ${UNIT_PRICE}円(税込)から追加できます。`
            : `1件 ${UNIT_PRICE}円(税込)・最低料金 ${formatYen(MIN_TOTAL)}(${MIN_SEATS}件まで)。1名1回の健康診断で1件です(定期と特殊健診を受けた方は2件)。`}
        </div>
      </div>
      {price && (
        <p style={{ fontSize: 16 }}>
          お支払い金額: <strong>{formatYen(price.total)}</strong>(税込)
          {!hasPlan && price.granted > n && <span className="muted"> ・{price.granted}件までご利用いただけます</span>}
        </p>
      )}
      <label className="checkbox-row" style={{ marginBottom: 12 }}>
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>
          <Link href="/iken/terms" target="_blank">利用規約</Link>に同意します(お申込み後のキャンセル・返金はできません)
        </span>
      </label>
      <button type="button" className="btn orange" disabled={!valid || !agree || busy} onClick={submit}>
        {busy ? "決済画面を開いています…" : hasPlan ? "件数を追加してお支払いへ" : `${year}年度を申し込んでお支払いへ`}
      </button>
      {error && <p className="error-message">{error}</p>}
      <p className="muted" style={{ marginBottom: 0 }}>
        お支払いは決済代行会社(Stripe)の画面で行います。カード番号は当事務所には届きません。
      </p>
    </div>
  );
}
