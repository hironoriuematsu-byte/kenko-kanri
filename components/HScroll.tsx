"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// 横に長い表の上下に横スクロールバーを出す。
// 上のバーは表と同じ幅のダミーで、下(表本体)のスクロールと連動させる。
// 表がはみ出していないときは上のバーを出さない。
// maxHeight を指定すると、行が多いときは表の中だけを縦にスクロールできる(見出しは上に固定)
export default function HScroll({ children, maxHeight }: { children: ReactNode; maxHeight?: string | number }) {
  const topRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [overflow, setOverflow] = useState(false);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const update = () => {
      setWidth(body.scrollWidth);
      setOverflow(body.scrollWidth > body.clientWidth + 1);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(body);
    if (body.firstElementChild) ro.observe(body.firstElementChild);
    return () => ro.disconnect();
  }, []);

  // 片方を動かしたらもう片方も同じ位置にする(往復で呼ばれても同じ値なので止まる)
  const sync = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (from && to && to.scrollLeft !== from.scrollLeft) to.scrollLeft = from.scrollLeft;
  };

  return (
    <div>
      {overflow && (
        <div
          ref={topRef}
          onScroll={() => sync(topRef.current, bodyRef.current)}
          style={{ overflowX: "auto", overflowY: "hidden", height: 14, marginBottom: 2 }}
          aria-hidden
        >
          <div style={{ width, height: 1 }} />
        </div>
      )}
      <div
        ref={bodyRef}
        onScroll={() => sync(bodyRef.current, topRef.current)}
        className={maxHeight !== undefined ? "sticky-head" : undefined}
        style={{ overflowX: "auto", overflowY: maxHeight !== undefined ? "auto" : undefined, maxHeight }}
      >
        {children}
      </div>
    </div>
  );
}
