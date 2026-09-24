/** Content model for the portfolio. Everything the modules render comes from content.ts. */

export interface Link {
  label: string;
  href: string;
}

export interface Screenshot {
  src: string;
  alt: string;
}

export interface BaseItem {
  id: string;
  name: string;
  /** one-line description */
  tagline: string;
  /** the problem this addressed */
  problem: string;
  /** what was built */
  built: string;
  /** measurable outcome */
  result: string;
  stack: string[];
  links: Link[];
  screenshots?: Screenshot[];
  /** short architecture description for the detail view */
  architecture?: string;
}

export interface Project extends BaseItem {
  category: "project";
  /** mission-file code, e.g. PRJ-01 */
  code: string;
}

export type AgentStatus = "online" | "standby" | "offline";

export interface Agent extends BaseItem {
  category: "agent";
  role: string;
  status: AgentStatus;
  tools: string[];
}

export type NodeKind = "source" | "service" | "model" | "store" | "sink";

export interface SystemNode {
  id: string;
  label: string;
  kind: NodeKind;
  /** 0..100 across the diagram */
  x: number;
  /** 0..100 down the diagram */
  y: number;
}

export interface SystemEdge {
  from: string;
  to: string;
  label?: string;
}

export interface System extends BaseItem {
  category: "system";
  nodes: SystemNode[];
  edges: SystemEdge[];
}

export type Item = Project | Agent | System;
export type Category = Item["category"];
export type ModuleId = "projects" | "agents" | "systems";

export interface Profile {
  name: string;
  role: string;
  tagline: string;
  location: string;
  availability: string;
  links: Link[];
}
