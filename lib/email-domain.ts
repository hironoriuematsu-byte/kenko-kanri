// メールアドレスのドメインの入力ミスを見つける(例: ezweb.nb.jp → ezweb.ne.jp)。
// 存在しないドメインに送ったメールは届かず、送信サービス側で再送(Delivery Delayed)を繰り返した末に失敗するため、
// 登録・招待の時点で気づけるようにする。サーバー側の DNS 確認は email-domain-check.ts。

// 日本でよく使われるメールのドメイン(個人・携帯キャリア・プロバイダ)
export const COMMON_EMAIL_DOMAINS = [
  "gmail.com",
  "yahoo.co.jp",
  "ymail.ne.jp",
  "icloud.com",
  "me.com",
  "outlook.jp",
  "outlook.com",
  "hotmail.com",
  "hotmail.co.jp",
  "live.jp",
  "docomo.ne.jp",
  "ezweb.ne.jp",
  "au.com",
  "softbank.ne.jp",
  "i.softbank.jp",
  "ymobile.ne.jp",
  "uqmobile.jp",
  "rakumail.jp",
  "nifty.com",
  "biglobe.ne.jp",
  "so-net.ne.jp",
  "ocn.ne.jp",
  "plala.or.jp",
  "dion.ne.jp",
  "excite.co.jp",
  "mail.goo.ne.jp",
  "yahoo.com",
];

export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return "";
  return email.slice(at + 1).trim().toLowerCase();
}

// 編集距離(置換・挿入・削除・隣接する2文字の入れ替え)。gmali.com のような入れ替えミスも1として数える
function editDistance(a: string, b: string): number {
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    rows[i] = [];
    for (let j = 0; j <= b.length; j++) {
      if (i === 0) rows[i][j] = j;
      else if (j === 0) rows[i][j] = i;
      else {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let v = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          v = Math.min(v, rows[i - 2][j - 2] + 1);
        }
        rows[i][j] = v;
      }
    }
  }
  return rows[a.length][b.length];
}

// よくあるドメインに近い(編集距離2以下)が一致しないとき、正しそうなドメインを返す。
// 一致している・似ていない・短すぎるときは null
export function suggestEmailDomain(email: string): string | null {
  const domain = emailDomain(email);
  if (!domain || domain.length < 5 || !domain.includes(".")) return null;
  if (COMMON_EMAIL_DOMAINS.includes(domain)) return null;
  let best: string | null = null;
  let bestDist = Infinity;
  for (const d of COMMON_EMAIL_DOMAINS) {
    const dist = editDistance(domain, d);
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  // 短いドメインは1文字違いでも別物のことがあるため、距離は長さに応じて制限する
  const limit = domain.length >= 10 ? 2 : 1;
  return best && bestDist <= limit ? best : null;
}

// 入力ミスの疑いがあるときに、修正候補のアドレスを返す
export function suggestEmail(email: string): string | null {
  const d = suggestEmailDomain(email);
  if (!d) return null;
  const at = email.lastIndexOf("@");
  return email.slice(0, at + 1) + d;
}
