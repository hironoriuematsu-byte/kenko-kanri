"use client";

import { useEffect, useRef, useState } from "react";

// 音声入力(パソコン向け)。ブラウザ標準の音声認識(Web Speech API)を使う。
//   ・Chrome / Edge で動作。非対応のブラウザ(Firefox など)とスマートフォン・タブレットでは表示しない
//     (スマートフォンはキーボードのマイクを使う)
//   ・押すと聞き取りを開始し、もう一度押すまで続ける。確定した文を onAppend で入力欄の末尾に足す
//   ・「改行」「句点」「読点」と話すと、改行・「。」・「、」に置き換える
//   ・音声はブラウザの音声認識サービス(Chrome: Google / Edge: Microsoft)で文字に変換される。
//     健康管理Webのサーバーには音声は送られず、変換後の文字だけが入力欄に入る

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

function getRecognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// 話し言葉の指示を記号に置き換える
export function applyVoiceCommands(text: string): string {
  return text
    .replace(/\s*改行\s*/g, "\n")
    .replace(/\s*句点\s*/g, "。")
    .replace(/\s*読点\s*/g, "、");
}

// 入力欄の末尾に足すときのつなぎ(行頭・改行の直後ならそのまま、それ以外は続けて書く)
export function appendText(prev: string, chunk: string): string {
  if (!chunk) return prev;
  if (!prev || prev.endsWith("\n") || chunk.startsWith("\n")) return prev + chunk;
  return prev + chunk;
}

export default function VoiceInputButton({
  onAppend,
  label = "音声入力",
}: {
  onAppend: (chunk: string) => void;
  label?: string;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const wantRef = useRef(false); // 利用者が止めるまで聞き取りを続けるか
  const appendRef = useRef(onAppend);
  appendRef.current = onAppend;

  useEffect(() => {
    // パソコン(マウス操作)で、音声認識に対応したブラウザのときだけ表示する
    const desktop = typeof window !== "undefined" && window.matchMedia?.("(pointer: fine)").matches;
    setSupported(!!getRecognitionCtor() && !!desktop);
    return () => {
      wantRef.current = false;
      recRef.current?.abort();
    };
  }, []);

  const start = () => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    setError(null);
    const rec = new Ctor();
    rec.lang = "ja-JP";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let finalText = "";
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      if (finalText) appendRef.current(applyVoiceCommands(finalText));
      setInterim(interimText);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wantRef.current = false;
        setError("マイクの使用が許可されていません。ブラウザのアドレスバーのマイクの設定で「許可」にしてください。");
      } else if (e.error === "audio-capture") {
        wantRef.current = false;
        setError("マイクが見つかりません。マイクの接続を確認してください。");
      } else if (e.error === "network") {
        wantRef.current = false;
        setError("音声認識サービスに接続できませんでした。通信状況を確認してください。");
      }
      // no-speech / aborted は聞き取りを続ける(onend で再開)
    };
    rec.onend = () => {
      setInterim("");
      // 無音が続くとブラウザが自動で止めるため、利用者が止めるまで再開する
      if (wantRef.current) {
        try {
          rec.start();
          return;
        } catch {
          /* 再開できなければ終了 */
        }
      }
      setListening(false);
    };
    recRef.current = rec;
    wantRef.current = true;
    try {
      rec.start();
      setListening(true);
    } catch {
      setError("音声入力を開始できませんでした。");
    }
  };

  const stop = () => {
    wantRef.current = false;
    recRef.current?.stop();
    setListening(false);
  };

  if (!supported) return null;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginLeft: 8, verticalAlign: "middle" }}>
      <button
        type="button"
        onClick={listening ? stop : start}
        className={`btn ${listening ? "" : "secondary"}`}
        style={{ padding: "2px 10px", fontSize: 12, ...(listening ? { background: "var(--danger)", borderColor: "var(--danger)" } : {}) }}
        title="パソコンのマイクで話した内容を入力欄の末尾に追加します。「改行」「句点」「読点」と話すと改行・。・、になります。音声はブラウザの音声認識（Chrome: Google、Edge: Microsoft）で文字に変換されます。"
        aria-pressed={listening}
      >
        {listening ? "■ 停止" : `🎤 ${label}`}
      </button>
      {listening && (
        <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
          聞き取り中…{interim && <>「{interim}」</>}
        </span>
      )}
      {error && (
        <span className="error-message" style={{ fontSize: 12, margin: 0, fontWeight: 400 }}>
          {error}
        </span>
      )}
    </span>
  );
}
