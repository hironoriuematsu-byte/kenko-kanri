// 一覧 → 個別の画面 → 一覧 と戻ったときに、開いた人の行の位置に戻すための記録(このタブの中だけ・2時間まで)。
// 一覧のURL(年度・実施回・区分の条件付き)と、開いた記録のIDを覚える
const KEY = "hm-list-return";
const TTL_MS = 2 * 3600_000;

export type ListReturn = { url: string; id: string; at: number };

export function rememberListPosition(id: string) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ url: location.pathname + location.search, id, at: Date.now() }));
  } catch {
    /* ストレージが使えない環境では何もしない */
  }
}

export function readListReturn(): ListReturn | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as ListReturn | null;
    if (!v || typeof v.url !== "string" || typeof v.id !== "string" || Date.now() - v.at > TTL_MS) return null;
    return v;
  } catch {
    return null;
  }
}

export function clearListReturn() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* 何もしない */
  }
}
