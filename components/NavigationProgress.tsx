"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { NAV_PROGRESS_EVENT } from "@/lib/navigate";

// 画面の切り替え中に、上端の進行バーと「読み込んでいます…」の表示を出す。
// サーバー側でデータを集めている間は画面が変わらないため、押した直後に
// 反応があることを示す(固まっているように見えるのを防ぐ)。
//   ・同じサイト内のリンクを押したとき / フォームを送信したときに表示
//   ・URL(パスや検索条件)が変わったら消す。念のため 20秒で自動的に消す
export default function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [active, setActive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // URLが変わった = 新しい画面が表示された
  useEffect(() => {
    setActive(false);
    if (timer.current) clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams?.toString()]);

  useEffect(() => {
    const start = () => {
      setActive(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setActive(false), 20000);
    };

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a");
      if (!a) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || a.target === "_blank" || a.hasAttribute("download")) return;
      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      // 同じURLへの移動は画面が変わらないので出さない
      if (url.pathname + url.search === window.location.pathname + window.location.search) return;
      start();
    };

    const onSubmit = (e: SubmitEvent) => {
      if (e.defaultPrevented) return;
      start();
    };

    // ボタンから router.push / router.replace で切り替えるとき(lib/navigate.ts)
    const onManual = () => start();

    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    window.addEventListener(NAV_PROGRESS_EVENT, onManual);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      window.removeEventListener(NAV_PROGRESS_EVENT, onManual);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (!active) return null;
  return (
    <div className="nav-progress" role="status" aria-live="polite">
      <div className="nav-progress-bar" />
      <div className="nav-progress-label">読み込んでいます…</div>
    </div>
  );
}
