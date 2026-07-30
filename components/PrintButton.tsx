"use client";

export default function PrintButton() {
  return (
    <button className="btn" onClick={() => window.print()}>
      印刷 / PDFとして保存
    </button>
  );
}
