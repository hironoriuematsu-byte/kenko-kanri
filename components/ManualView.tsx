"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MANUAL_SECTIONS, findManualSection, type ManualBlock } from "@/lib/manual";

// 使い方マニュアル。左(狭い画面では上)のタブでセクションを切り替える。
// URLの ?section= と同期するので、各画面の「使い方」リンクから該当セクションを直接開ける
export default function ManualView({ initialSection }: { initialSection?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [key, setKey] = useState(findManualSection(initialSection).key);

  // 戻る/進むや別リンクからの遷移でURLが変わったら追従する
  useEffect(() => {
    const s = searchParams?.get("section") ?? undefined;
    if (s && s !== key) setKey(findManualSection(s).key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const select = (k: string) => {
    setKey(k);
    router.replace(`/company/manual?section=${k}`, { scroll: false });
  };

  const section = findManualSection(key);

  return (
    <div className="manual">
      <nav className="manual-nav" aria-label="マニュアルの目次">
        {MANUAL_SECTIONS.map((s) => (
          <button
            key={s.key}
            className={`manual-tab${s.key === section.key ? " active" : ""}`}
            onClick={() => select(s.key)}
            aria-current={s.key === section.key ? "page" : undefined}
          >
            <span aria-hidden style={{ marginRight: 6 }}>
              {s.icon}
            </span>
            {s.title}
          </button>
        ))}
      </nav>
      <article className="manual-body">
        <h2 style={{ marginTop: 0 }}>
          <span aria-hidden style={{ marginRight: 8 }}>
            {section.icon}
          </span>
          {section.title}
        </h2>
        <p className="muted">{section.lead}</p>
        {section.topics.map((t) => (
          <section key={t.heading} style={{ marginTop: 18 }}>
            <h3 className="manual-h3">{t.heading}</h3>
            {t.blocks.map((b, i) => (
              <Block key={i} block={b} />
            ))}
          </section>
        ))}
        <p className="muted" style={{ fontSize: 12, marginTop: 24 }}>
          ご不明な点は産業医事務所までお問い合わせください。
        </p>
      </article>
    </div>
  );
}

function Block({ block }: { block: ManualBlock }) {
  switch (block.type) {
    case "p":
      return <p>{block.text}</p>;
    case "steps":
      return (
        <ol className="manual-steps">
          {block.items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ol>
      );
    case "list":
      return (
        <ul className="manual-list">
          {block.items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ul>
      );
    case "note":
      return <div className="notice">{block.text}</div>;
    case "table":
      return (
        <div style={{ overflowX: "auto" }}>
          <table className="list" style={{ marginBottom: 10 }}>
            <thead>
              <tr>
                {block.header.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} style={j === 0 ? { whiteSpace: "nowrap", fontWeight: 600 } : {}}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}
