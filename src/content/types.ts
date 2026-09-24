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

/** A reusable skill an agent can load: a packaged capability with its own instructions and tools. */
export interface Skill extends BaseItem {
  category: "skill";
  /** when an agent reaches for it */
  trigger: string;
  tools: string[];
  /** ids of the agents that load this skill */
  usedBy: string[];
  version: string;
}

export type Item = Project | Agent | Skill | System;
export type Category = Item["category"];
/** the four content modules plus the about section, which shares their layout */
export type ModuleId = "projects" | "agents" | "skills" | "systems" | "about";
export type ContentModuleId = Exclude<ModuleId, "about">;

export interface Fact {
  label: string;
  value: string;
}

export interface TimelineEntry {
  year: string;
  title: string;
  note: string;
}

export interface About {
  /** short paragraphs */
  intro: string[];
  /** one line on what you are doing now */
  now: string;
  facts: Fact[];
  timeline: TimelineEntry[];
  /** optional portrait in public/ */
  photo?: string;
}

export interface Profile {
  name: string;
  role: string;
  tagline: string;
  location: string;
  availability: string;
  links: Link[];
}
