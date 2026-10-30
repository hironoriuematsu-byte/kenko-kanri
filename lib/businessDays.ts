// ============================================================
// 営業日の計算(健診結果の医師意見聴取Webの返却期限)
//
// 休業日: 土曜・日曜・国民の祝日(振替休日・国民の休日を含む)・年末年始(12/29〜1/3)
// 受付: 営業日の17時までに届いたものはその日の受付、17時以降・休業日に届いたものは次の営業日の受付
// 返却期限: 受付日を0日目として、3営業日目の終わり(例: 月曜受付 → 木曜まで)
//
// 祝日は内閣府の公表に基づき、年ごとに追加する(未登録の年は土日・年末年始だけで計算する)
// ============================================================

export const IKEN_RETURN_DAYS = 3; // 返却期限(営業日)
export const RECEIPT_CUTOFF_HOUR = 17; // この時刻(日本時間)以降に届いたものは次の営業日の受付

const HOLIDAYS = new Set<string>([
  // 2026年(令和8年)
  "2026-01-01", "2026-01-12", "2026-02-11", "2026-02-23", "2026-03-20", "2026-04-29",
  "2026-05-03", "2026-05-04", "2026-05-05", "2026-05-06", "2026-07-20", "2026-08-11",
  "2026-09-21", "2026-09-22", "2026-09-23", "2026-10-12", "2026-11-03", "2026-11-23",
  // 2027年(令和9年)
  "2027-01-01", "2027-01-11", "2027-02-11", "2027-02-23", "2027-03-21", "2027-03-22",
  "2027-04-29", "2027-05-03", "2027-05-04", "2027-05-05", "2027-07-19", "2027-08-11",
  "2027-09-20", "2027-09-23", "2027-10-11", "2027-11-03", "2027-11-23",
  // 2028年(令和10年)
  "2028-01-01", "2028-01-10", "2028-02-11", "2028-02-23", "2028-03-20", "2028-04-29",
  "2028-05-03", "2028-05-04", "2028-05-05", "2028-07-17", "2028-08-11", "2028-09-18",
  "2028-09-22", "2028-10-09", "2028-11-03", "2028-11-23",
]);

const JST_MS = 9 * 3600 * 1000;

// "YYYY-MM-DD"(日本時間の日付)
export const jstDateOf = (d: Date): string => new Date(d.getTime() + JST_MS).toISOString().slice(0, 10);
const jstHourOf = (d: Date): number => new Date(d.getTime() + JST_MS).getUTCHours();

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isBusinessDay(ymd: string): boolean {
  const d = new Date(`${ymd}T00:00:00Z`);
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const md = ymd.slice(5);
  if (md >= "12-29" || md <= "01-03") return false; // 年末年始
  return !HOLIDAYS.has(ymd);
}

export function nextBusinessDay(ymd: string): string {
  let d = addDays(ymd, 1);
  while (!isBusinessDay(d)) d = addDays(d, 1);
  return d;
}

// 受付日(日本時間の日付)
export function receiptDate(receivedAt: Date): string {
  const day = jstDateOf(receivedAt);
  if (isBusinessDay(day) && jstHourOf(receivedAt) < RECEIPT_CUTOFF_HOUR) return day;
  return nextBusinessDay(day);
}

// 返却期限(日本時間の日付。この日の終わりまで)
export function returnDueDate(receivedAt: Date, days: number = IKEN_RETURN_DAYS): string {
  let d = receiptDate(receivedAt);
  for (let i = 0; i < days; i++) d = nextBusinessDay(d);
  return d;
}

// 今日から期限までの残りの営業日(今日が期限なら0、過ぎていれば負の数)
export function businessDaysLeft(due: string, now: Date = new Date()): number {
  const today = jstDateOf(now);
  if (today === due) return 0;
  if (today < due) {
    let n = 0;
    let d = today;
    while (d < due) {
      d = addDays(d, 1);
      if (isBusinessDay(d)) n++;
    }
    return n;
  }
  let n = 0;
  let d = due;
  while (d < today) {
    d = addDays(d, 1);
    if (isBusinessDay(d)) n--;
  }
  return Math.min(n, -1);
}

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];
// 2026-11-05 → 11月5日(木)
export function formatMdW(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日(${WEEK[d.getUTCDay()]})`;
}
