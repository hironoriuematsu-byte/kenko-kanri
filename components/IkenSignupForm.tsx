"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { suggestEmailDomain } from "@/lib/email-domain";

type Field = { key: string; label: string; type?: string; placeholder?: string; help?: string; autoComplete?: string };

const FIELDS: Field[] = [
  { key: "companyName", label: "会社名", placeholder: "株式会社〇〇", autoComplete: "organization" },
  { key: "officeName", label: "事業場名", placeholder: "本社(事業場が1つの場合)", help: "健康診断の意見聴取は事業場ごとです。複数の事業場がある場合は、事業場ごとにご登録ください。" },
  { key: "address", label: "事業場の所在地", placeholder: "京都府京都市〇〇区…", autoComplete: "street-address" },
  { key: "workers", label: "事業場の労働者数", type: "number", placeholder: "例: 25" },
  { key: "contactName", label: "ご担当者の氏名", placeholder: "山田 花子", autoComplete: "name" },
  { key: "contactEmail", label: "メールアドレス(ログインに使います)", type: "email", autoComplete: "email" },
  { key: "contactPhone", label: "電話番号", type: "tel", placeholder: "075-000-0000", autoComplete: "tel" },
  { key: "password", label: "パスワード(8文字以上)", type: "password", autoComplete: "new-password" },
];

export default function IkenSignupForm() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [bizId, setBizId] = useState("");
  const [noBizId, setNoBizId] = useState(false);
  const [workInfo, setWorkInfo] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const set = (k: string, v: string) => setValues((prev) => ({ ...prev, [k]: v }));
  const emailHint = values.contactEmail ? suggestEmailDomain(values.contactEmail) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/iken/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, bizId, noBizId, workInfo, agreeTerms: agree }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "登録できませんでした。");
        return;
      }
      setDone(true);
    } catch {
      setError("通信できませんでした。電波の良いところでもう一度お試しください。");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="card">
        <h2>確認メールをお送りしました</h2>
        <p>
          <strong>{values.contactEmail}</strong> に確認メールをお送りしました。メールのリンクを開き、「アカウントを有効にして担当者の画面へ」を押してください。
        </p>
        <p className="muted" style={{ marginBottom: 0 }}>
          数分たっても届かない場合は、迷惑メールのフォルダをご確認のうえ、support@mestate.jp までご連絡ください。
        </p>
      </div>
    );
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>会社(事業場)の登録</h2>
      {FIELDS.slice(0, 1).map((f) => (
        <Row key={f.key} f={f} value={values[f.key] ?? ""} onChange={(v) => set(f.key, v)} />
      ))}
      <div className="form-row">
        <label htmlFor="bizId">登録番号(インボイス)または法人番号</label>
        <input
          id="bizId"
          type="text"
          inputMode="text"
          value={bizId}
          onChange={(e) => setBizId(e.target.value)}
          placeholder="T1234567890123 または 1234567890123"
          disabled={noBizId}
        />
        <label className="checkbox-row" style={{ fontWeight: "normal", color: "inherit", marginTop: 6 }}>
          <input type="checkbox" checked={noBizId} onChange={(e) => setNoBizId(e.target.checked)} />
          どちらも持っていない(個人事業主の方など)
        </label>
      </div>
      {FIELDS.slice(1, 4).map((f) => (
        <Row key={f.key} f={f} value={values[f.key] ?? ""} onChange={(v) => set(f.key, v)} />
      ))}
      <div className="form-row">
        <label htmlFor="workInfo">主な業務内容・勤務形態</label>
        <textarea
          id="workInfo"
          value={workInfo}
          onChange={(e) => setWorkInfo(e.target.value)}
          placeholder={"例: 事務職10名、製造ライン(有機溶剤を使用)12名、配送ドライバー3名。製造ラインは2交替(深夜業あり)。"}
          style={{ minHeight: 90 }}
        />
        <div className="muted">医師が就業上の意見を述べるために必要な情報です(労働時間・深夜業・運転業務・有害業務の有無など)。あとから変更できます。</div>
      </div>
      {FIELDS.slice(4).map((f) => (
        <Row key={f.key} f={f} value={values[f.key] ?? ""} onChange={(v) => set(f.key, v)} />
      ))}
      {emailHint && (
        <div className="notice">
          メールアドレスは「{emailHint}」ではありませんか？ 入力をご確認ください。
        </div>
      )}
      <label className="checkbox-row" style={{ margin: "8px 0 14px" }}>
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>
          <Link href="/iken/terms" target="_blank">利用規約</Link>と
          <Link href="/privacy" target="_blank">個人情報の取扱い</Link>に同意します
        </span>
      </label>
      <button type="submit" className="btn orange" disabled={busy || !agree} style={{ fontSize: 16, padding: "12px 26px" }}>
        {busy ? "登録しています…" : "登録して確認メールを受け取る"}
      </button>
      {error && <p className="error-message">{error}</p>}
      <p className="muted" style={{ marginBottom: 0 }}>登録は無料です。お支払いはログイン後、件数を入力して行います。</p>
    </form>
  );
}

function Row({ f, value, onChange }: { f: Field; value: string; onChange: (v: string) => void }) {
  return (
    <div className="form-row">
      <label htmlFor={f.key}>{f.label}</label>
      <input
        id={f.key}
        type={f.type ?? "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={f.placeholder}
        autoComplete={f.autoComplete}
        min={f.type === "number" ? 1 : undefined}
        required
      />
      {f.help && <div className="muted">{f.help}</div>}
    </div>
  );
}
