"use client";

import { useEffect, useRef, useState } from "react";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&<>/\\|=+*";

export interface DecodeProps {
  text: string;
  /** start the effect (false shows scrambled glyphs, true resolves) */
  active: boolean;
  /** total duration in ms */
  duration?: number;
  className?: string;
  /** render the plain text with no effect */
  reduced?: boolean;
  as?: "span" | "h1" | "h2" | "div";
  style?: React.CSSProperties;
}

/** Scrambled characters resolving left to right into the real text. */
export default function Decode({ text, active, duration = 700, className, reduced = false, as: Tag = "span", style }: DecodeProps) {
  const [out, setOut] = useState(() => scrambleStatic(text));
  const raf = useRef(0);

  useEffect(() => {
    if (reduced || !active) return;
    const start = performance.now();
    const tick = () => {
      const p = Math.min(1, (performance.now() - start) / duration);
      setOut(scramble(text, p));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [text, active, duration, reduced]);

  // the real text stays in the accessibility tree; the scramble is decoration
  return (
    <Tag className={className} style={style}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>{reduced ? text : out}</span>
    </Tag>
  );
}

/** Deterministic scramble for the first render, so server and client agree. */
function scrambleStatic(text: string): string {
  let s = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    s += ch === " " ? ch : GLYPHS[(i * 7 + text.length) % GLYPHS.length];
  }
  return s;
}

function scramble(text: string, progress: number): string {
  const resolved = Math.floor(progress * text.length);
  let s = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === " " || i < resolved) s += ch;
    else s += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
  }
  return s;
}
