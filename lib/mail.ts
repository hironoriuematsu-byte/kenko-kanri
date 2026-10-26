// メール送信(Resend)。環境変数 RESEND_API_KEY・SENDER_EMAIL(ストレスチェックWebと同じ値)を Vercel に設定する
export const mailConfigured = (): boolean => Boolean(process.env.RESEND_API_KEY && process.env.SENDER_EMAIL);

// 1通送る。宛先どうしが見えないよう、1人ずつ送る
export async function sendMail(to: string, subject: string, text: string): Promise<{ ok: boolean; detail?: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.SENDER_EMAIL;
  if (!key || !from) return { ok: false, detail: "RESEND_API_KEY / SENDER_EMAIL が未設定" };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject, text }),
      });
      if (res.ok) return { ok: true };
      // 送りすぎ(429)・一時的な失敗(5xx)は少し待ってやり直す
      if (res.status === 429 || res.status >= 500) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      return { ok: false, detail: `${res.status} ${(await res.text()).slice(0, 200)}` };
    } catch (e) {
      await sleep(1000 * (attempt + 1));
      if (attempt === 2) return { ok: false, detail: String(e) };
    }
  }
  return { ok: false, detail: "送信に失敗しました" };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
