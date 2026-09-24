"use client";

import type { NodeKind, System } from "@/content/types";

const KIND_LABEL: Record<NodeKind, string> = { source: "SRC", service: "SVC", model: "MDL", store: "DB", sink: "OUT" };
const W = 100;
const H = 50; // 2:1 diagram; content y (0..100) maps to 0..50

function bezier(t: number, p0: number, p1: number, p2: number, p3: number) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/**
 * Architecture diagram: nodes on a grid connected by flowing light lines.
 * The flow is an animated dash pattern along each edge (CSS keyframes, no JS per frame).
 */
export default function SystemDiagram({ system, height = 150 }: { system: System; height?: number }) {
  const byId = Object.fromEntries(system.nodes.map((n) => [n.id, { ...n, y: n.y * 0.5 }]));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${system.name} architecture`} className="block w-full" style={{ height }}>
      <defs>
        <filter id={`glow-${system.id}`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="0.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {system.edges.map((e, i) => {
        const a = byId[e.from];
        const b = byId[e.to];
        if (!a || !b) return null;
        const mx = (a.x + b.x) / 2;
        const d = `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`;
        const lx = bezier(0.42, a.x, mx, mx, b.x);
        const ly = bezier(0.42, a.y, a.y, b.y, b.y);
        return (
          <g key={`${e.from}-${e.to}-${i}`}>
            <path d={d} fill="none" stroke="var(--steel-line)" strokeWidth={0.5} />
            <path
              d={d}
              fill="none"
              stroke="var(--gold)"
              strokeWidth={0.8}
              strokeDasharray="4 8"
              className="animate-[flow_1.6s_linear_infinite]"
              style={{ animationDelay: `${-i * 0.3}s` }}
              filter={`url(#glow-${system.id})`}
            />
            {e.label ? (
              <text x={lx} y={ly - 1.6} textAnchor="middle" fontSize={2.8} fill="var(--steel)" fontFamily="var(--font-mono)" letterSpacing={0.3}>
                {e.label}
              </text>
            ) : null}
          </g>
        );
      })}
      {system.nodes.map((n) => (
        <g key={n.id} transform={`translate(${n.x} ${n.y * 0.5})`}>
          <rect x={-8} y={-4} width={16} height={8} rx={0.4} fill="var(--bg-2)" stroke={n.kind === "model" ? "var(--gold)" : "var(--gold-line)"} strokeWidth={0.4} />
          <text y={-0.4} textAnchor="middle" fontSize={2.9} fill="var(--fg)" fontFamily="var(--font-mono)">
            {n.label.toUpperCase()}
          </text>
          <text y={2.6} textAnchor="middle" fontSize={2.1} fill="var(--steel)" fontFamily="var(--font-mono)" letterSpacing={0.3}>
            {KIND_LABEL[n.kind]}
          </text>
        </g>
      ))}
    </svg>
  );
}
