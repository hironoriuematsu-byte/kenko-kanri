"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

// QRコード画像(URL等を文字列で受け取り、ブラウザ側で描画する)
export default function QrCode({ value, size = 120 }: { value: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { margin: 1, width: size * 2, errorCorrectionLevel: "M" })
      .then((url) => {
        if (alive) setSrc(url);
      })
      .catch(() => {
        if (alive) setSrc(null);
      });
    return () => {
      alive = false;
    };
  }, [value, size]);
  if (!src) return <div style={{ width: size, height: size }} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} width={size} height={size} alt="受診報告用QRコード" style={{ display: "block" }} />;
}
