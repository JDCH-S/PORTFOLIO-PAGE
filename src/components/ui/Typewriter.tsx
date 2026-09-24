"use client";

import { useEffect, useState } from "react";

export interface TypewriterProps {
  text: string;
  active: boolean;
  /** ms per character */
  speed?: number;
  className?: string;
  reduced?: boolean;
  caret?: boolean;
}

/** Types text out character by character with a blinking block caret. */
export default function Typewriter({ text, active, speed = 34, className, reduced = false, caret = true }: TypewriterProps) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (reduced || !active) return;
    let i = 0;
    const id = setInterval(() => {
      i++;
      setN(i);
      if (i >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, active, speed, reduced]);
  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>{text.slice(0, reduced ? text.length : n)}</span>
      {caret ? <span aria-hidden className="ml-[2px] inline-block h-[1em] w-[0.55em] translate-y-[2px] animate-[caret_1s_steps(1)_infinite] bg-gold" /> : null}
    </span>
  );
}
