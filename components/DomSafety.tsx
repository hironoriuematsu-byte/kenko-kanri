"use client";

import { useEffect } from "react";

// ブラウザ翻訳機能(Google翻訳等)がDOMを書き換えた際に
// Reactの removeChild / insertBefore が例外で落ちるのを防ぐ
// (既存ストレスチェックWebのDomSafetyと同等の対策)
export default function DomSafety() {
  useEffect(() => {
    if ((window as any).__hmDomSafetyInstalled) return;
    (window as any).__hmDomSafetyInstalled = true;

    const origRemoveChild = Node.prototype.removeChild;
    Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
      if (child.parentNode !== this) {
        return child;
      }
      return origRemoveChild.call(this, child) as T;
    };

    const origInsertBefore = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function <T extends Node>(
      this: Node,
      newNode: T,
      referenceNode: Node | null
    ): T {
      if (referenceNode && referenceNode.parentNode !== this) {
        return origInsertBefore.call(this, newNode, null) as T;
      }
      return origInsertBefore.call(this, newNode, referenceNode) as T;
    };
  }, []);

  return null;
}
