// ボタンから router.push / router.replace で画面を切り替えるときに、
// 画面上端の「読み込んでいます…」(components/NavigationProgress)を出す。
// リンク(<a>)を押したときは自動で出るが、ボタンからの切り替えはこれを呼ぶ
export const NAV_PROGRESS_EVENT = "nav-progress:start";

export function startNavigationProgress() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(NAV_PROGRESS_EVENT));
}
