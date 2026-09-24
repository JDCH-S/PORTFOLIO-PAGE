import type { AgentStatus } from "@/content/types";

const COLOR: Record<AgentStatus, string> = {
  online: "bg-online",
  standby: "bg-standby",
  offline: "bg-offline",
};

/** Pulsing status indicator with its label. */
export default function StatusDot({ status, className = "" }: { status: AgentStatus; className?: string }) {
  return (
    <span className={`label inline-flex items-center gap-2 ${className}`}>
      <span className="relative inline-flex h-2 w-2">
        {status === "online" ? (
          <span className={`absolute inset-0 animate-[core-ping_1.8s_cubic-bezier(0,0,0.2,1)_infinite] rounded-full ${COLOR[status]} opacity-60`} />
        ) : null}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${COLOR[status]}`} />
      </span>
      <span className={status === "online" ? "text-online" : status === "standby" ? "text-standby" : "text-offline"}>{status}</span>
    </span>
  );
}
