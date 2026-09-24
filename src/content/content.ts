/**
 * THE single data file. Add an item to the right array and it appears in its module;
 * nothing here is imported by the sphere, and no component hard-codes an item.
 *
 * Every entry below is a PLACEHOLDER in the exact shape to fill in.
 */
import type { Agent, Profile, Project, System } from "./types";

export const profile: Profile = {
  name: "Juan Diego Chiriboga",
  role: "AI engineer",
  tagline: "Projects, agents and systems, emerging from a holographic core.",
  location: "PLACEHOLDER · city",
  availability: "PLACEHOLDER · open to work",
  links: [
    { label: "GitHub", href: "https://github.com/JDCH-S" },
    { label: "LinkedIn", href: "https://www.linkedin.com/" },
    { label: "Email", href: "mailto:juandiegochiriboga3@gmail.com" },
  ],
};

export const projects: Project[] = [
  {
    category: "project",
    id: "prj-01",
    code: "PRJ-01",
    name: "PLACEHOLDER · Project one",
    tagline: "One line on what this project does.",
    problem: "The problem it addressed, in a sentence or two.",
    built: "What was built: the approach, the parts, the decisions that mattered.",
    result: "A measurable result, e.g. 42% faster, 3× fewer tickets, $12k/month saved.",
    stack: ["Next.js", "TypeScript", "PostgreSQL"],
    links: [
      { label: "Demo", href: "https://example.com" },
      { label: "GitHub", href: "https://github.com/JDCH-S" },
    ],
    architecture: "Short architecture note for the detail view.",
    screenshots: [],
  },
  {
    category: "project",
    id: "prj-02",
    code: "PRJ-02",
    name: "PLACEHOLDER · Project two",
    tagline: "One line on what this project does.",
    problem: "The problem it addressed.",
    built: "What was built.",
    result: "A measurable result.",
    stack: ["Python", "FastAPI", "Docker"],
    links: [{ label: "GitHub", href: "https://github.com/JDCH-S" }],
  },
  {
    category: "project",
    id: "prj-03",
    code: "PRJ-03",
    name: "PLACEHOLDER · Project three",
    tagline: "One line on what this project does.",
    problem: "The problem it addressed.",
    built: "What was built.",
    result: "A measurable result.",
    stack: ["React", "Three.js"],
    links: [{ label: "Demo", href: "https://example.com" }],
  },
];

export const agents: Agent[] = [
  {
    category: "agent",
    id: "agt-01",
    name: "PLACEHOLDER · Agent one",
    role: "Research assistant",
    status: "online",
    tools: ["web search", "vector store", "python"],
    tagline: "One line on what this agent does.",
    problem: "The problem it addressed.",
    built: "How it was built: model, tools, memory, guardrails, evaluation.",
    result: "A measurable result, e.g. 80% of tickets resolved without a human.",
    stack: ["Claude", "LangGraph", "Postgres + pgvector"],
    links: [{ label: "GitHub", href: "https://github.com/JDCH-S" }],
  },
  {
    category: "agent",
    id: "agt-02",
    name: "PLACEHOLDER · Agent two",
    role: "Ops automation",
    status: "online",
    tools: ["slack", "jira", "sql"],
    tagline: "One line on what this agent does.",
    problem: "The problem it addressed.",
    built: "How it was built.",
    result: "A measurable result.",
    stack: ["Claude", "TypeScript", "Temporal"],
    links: [],
  },
  {
    category: "agent",
    id: "agt-03",
    name: "PLACEHOLDER · Agent three",
    role: "Data steward",
    status: "standby",
    tools: ["bigquery", "dbt", "email"],
    tagline: "One line on what this agent does.",
    problem: "The problem it addressed.",
    built: "How it was built.",
    result: "A measurable result.",
    stack: ["Python", "Airflow"],
    links: [],
  },
];

export const systems: System[] = [
  {
    category: "system",
    id: "sys-01",
    name: "PLACEHOLDER · System one",
    tagline: "One line on what this system does.",
    problem: "The problem it addressed.",
    built: "What was built and how the pieces fit.",
    result: "A measurable result, e.g. p95 latency 120ms at 5k rps.",
    stack: ["Kafka", "Go", "ClickHouse"],
    links: [{ label: "Write-up", href: "https://example.com" }],
    architecture: "Events flow from the sources through the stream processor into the store and out to the dashboards.",
    nodes: [
      { id: "src", label: "Sources", kind: "source", x: 8, y: 50 },
      { id: "ingest", label: "Ingest", kind: "service", x: 32, y: 50 },
      { id: "model", label: "Model", kind: "model", x: 56, y: 25 },
      { id: "store", label: "Store", kind: "store", x: 56, y: 75 },
      { id: "api", label: "API", kind: "sink", x: 84, y: 50 },
    ],
    edges: [
      { from: "src", to: "ingest", label: "events" },
      { from: "ingest", to: "model", label: "features" },
      { from: "ingest", to: "store" },
      { from: "model", to: "api", label: "scores" },
      { from: "store", to: "api" },
    ],
  },
  {
    category: "system",
    id: "sys-02",
    name: "PLACEHOLDER · System two",
    tagline: "One line on what this system does.",
    problem: "The problem it addressed.",
    built: "What was built.",
    result: "A measurable result.",
    stack: ["AWS", "Terraform", "Postgres"],
    links: [],
    nodes: [
      { id: "web", label: "Web", kind: "source", x: 10, y: 30 },
      { id: "mobile", label: "Mobile", kind: "source", x: 10, y: 70 },
      { id: "gateway", label: "Gateway", kind: "service", x: 40, y: 50 },
      { id: "queue", label: "Queue", kind: "store", x: 66, y: 50 },
      { id: "workers", label: "Workers", kind: "service", x: 90, y: 50 },
    ],
    edges: [
      { from: "web", to: "gateway" },
      { from: "mobile", to: "gateway" },
      { from: "gateway", to: "queue", label: "jobs" },
      { from: "queue", to: "workers" },
    ],
  },
];

export const modules = [
  { id: "projects", title: "Projects", index: "01", items: projects },
  { id: "agents", title: "Agents", index: "02", items: agents },
  { id: "systems", title: "Systems", index: "03", items: systems },
] as const;
