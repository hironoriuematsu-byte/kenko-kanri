import crypto from "crypto";

// Google Meet REST API(v2)の呼び出し。サーバー側(API Route)からのみ使う。
// Google Workspace のサービスアカウントにドメイン全体の委任を設定し、
// 産業医の Workspace アカウント(GOOGLE_MEET_OWNER_EMAIL)として操作する。
// 作成したルームの主催者は産業医になる。
//
// 必要な環境変数(Vercel / .env.local):
//   GOOGLE_SERVICE_ACCOUNT_EMAIL        サービスアカウントのメールアドレス
//   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY  JSON鍵の private_key(改行は \n のままでよい)
//   GOOGLE_MEET_OWNER_EMAIL             ルームの主催者にする産業医の Workspace アカウント
//   GOOGLE_MEET_ACCESS_TYPE             任意。TRUSTED(既定) / OPEN / RESTRICTED

const SCOPES = [
  "https://www.googleapis.com/auth/meetings.space.created",
  "https://www.googleapis.com/auth/meetings.space.readonly",
];
const MEET_BASE = "https://meet.googleapis.com/v2/";

export function meetApiConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY &&
      process.env.GOOGLE_MEET_OWNER_EMAIL
  );
}

// アクセストークンは1時間有効。同じサーバーインスタンス内では使い回す
let cachedToken: { token: string; exp: number } | null = null;

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.token;

  const b64url = (s: string) => Buffer.from(s).toString("base64url");
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      sub: process.env.GOOGLE_MEET_OWNER_EMAIL,
      scope: SCOPES.join(" "),
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const key = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(`${header}.${claim}`)
    .sign(key)
    .toString("base64url");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claim}.${signature}`,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Googleの認証に失敗しました (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: json.access_token, exp: now + json.expires_in };
  return json.access_token;
}

async function meetFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(MEET_BASE + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Google Meet API エラー (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export type MeetSpace = { name: string; meetingUri: string; meetingCode: string };

// 常設ルーム(Meet の「スペース」)を作る。リンクは作り直さない限り変わらない
export async function createSpace(): Promise<MeetSpace> {
  const accessType = process.env.GOOGLE_MEET_ACCESS_TYPE || "TRUSTED";
  return meetFetch<MeetSpace>("spaces", {
    method: "POST",
    body: JSON.stringify({ config: { accessType, entryPointAccess: "ALL" } }),
  });
}

export type MeetParticipant = { name: string; since: string | null };

// いまルームに入っている人。会議が開かれていなければ空配列
export async function getActiveParticipants(spaceName: string): Promise<MeetParticipant[]> {
  const space = await meetFetch<{ activeConference?: { conferenceRecord?: string } }>(spaceName);
  const record = space.activeConference?.conferenceRecord;
  if (!record) return [];

  const filter = encodeURIComponent("latest_end_time IS NULL");
  const json = await meetFetch<{
    participants?: {
      earliestStartTime?: string;
      signedinUser?: { displayName?: string };
      anonymousUser?: { displayName?: string };
      phoneUser?: { displayName?: string };
    }[];
  }>(`${record}/participants?filter=${filter}&pageSize=50`);

  return (json.participants ?? []).map((p) => ({
    name:
      p.signedinUser?.displayName ||
      p.anonymousUser?.displayName ||
      p.phoneUser?.displayName ||
      "（名前不明）",
    since: p.earliestStartTime ?? null,
  }));
}

export type MeetConference = { start: string; end: string | null };

// このルームで開かれた会議の履歴(新しい順)。参加者名は含めない
export async function listConferences(spaceName: string, pageSize = 10): Promise<MeetConference[]> {
  const filter = encodeURIComponent(`space.name="${spaceName}"`);
  const json = await meetFetch<{ conferenceRecords?: { startTime: string; endTime?: string }[] }>(
    `conferenceRecords?filter=${filter}&pageSize=${pageSize}`
  );
  return (json.conferenceRecords ?? []).map((c) => ({ start: c.startTime, end: c.endTime ?? null }));
}
