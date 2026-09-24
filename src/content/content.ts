/**
 * THE single data file. Add an item to the right array and it appears in its module;
 * nothing here is imported by the sphere, and no component hard-codes an item.
 *
 * Every entry below is a PLACEHOLDER in the exact shape to fill in.
 */
import type { About, Agent, Profile, Project, Skill, System } from "./types";

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

/**
 * Skills are the reusable capabilities the agents load: packaged instructions plus the tools
 * they wrap (the way Claude loads a skill). Agents are the live units; skills are their kit.
 */
export const skills: Skill[] = [
  {
    category: "skill",
    id: "skl-01",
    name: "PLACEHOLDER · Skill one",
    version: "1.2.0",
    tagline: "One line on what this skill lets an agent do.",
    trigger: "When the task mentions a spreadsheet, a CSV or 'the numbers'.",
    tools: ["python", "openpyxl", "file read"],
    usedBy: ["agt-01", "agt-03"],
    problem: "The recurring task this skill packages.",
    built: "How it is built: the instructions, the checks, the tools it wraps, how it is evaluated.",
    result: "A measurable result, e.g. 92% first-pass accuracy on 300 files.",
    stack: ["Markdown", "Python"],
    links: [{ label: "GitHub", href: "https://github.com/JDCH-S" }],
  },
  {
    category: "skill",
    id: "skl-02",
    name: "PLACEHOLDER · Skill two",
    version: "0.9.0",
    tagline: "One line on what this skill lets an agent do.",
    trigger: "When an agent needs to search the web and cite what it found.",
    tools: ["web search", "fetch", "citations"],
    usedBy: ["agt-01"],
    problem: "The recurring task this skill packages.",
    built: "How it is built.",
    result: "A measurable result.",
    stack: ["Markdown", "TypeScript"],
    links: [],
  },
  {
    category: "skill",
    id: "skl-03",
    name: "PLACEHOLDER · Skill three",
    version: "2.0.1",
    tagline: "One line on what this skill lets an agent do.",
    trigger: "When a ticket, incident or alert needs triage.",
    tools: ["jira", "slack", "sql"],
    usedBy: ["agt-02"],
    problem: "The recurring task this skill packages.",
    built: "How it is built.",
    result: "A measurable result.",
    stack: ["Markdown", "Python"],
    links: [],
  },
];

export const about: About = {
  intro: [
    "PLACEHOLDER · Two or three sentences on who you are and what you build: the kind of problems you take on, the way you work, what you care about in a system.",
    "PLACEHOLDER · One paragraph on your path: where you started, what you learned along the way, and what you are looking for next.",
  ],
  now: "PLACEHOLDER · What you are building or exploring right now.",
  facts: [
    { label: "based in", value: "PLACEHOLDER · city" },
    { label: "focus", value: "agents, retrieval, evaluation" },
    { label: "languages", value: "Python, TypeScript" },
    { label: "availability", value: "open to work" },
  ],
  timeline: [
    { year: "2025", title: "PLACEHOLDER · Role or milestone", note: "One line on what it was." },
    { year: "2023", title: "PLACEHOLDER · Role or milestone", note: "One line on what it was." },
    { year: "2021", title: "PLACEHOLDER · Role or milestone", note: "One line on what it was." },
  ],
};

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
  { id: "projects", title: "Projects", index: "01", items: projects, blurb: "Mission files: the problem, what was built, the measurable result." },
  { id: "agents", title: "Agents", index: "02", items: agents, blurb: "Live units: their role, tools and activity." },
  { id: "skills", title: "Skills", index: "03", items: skills, blurb: "The reusable skills the agents load: instructions plus the tools they wrap." },
  { id: "systems", title: "Systems", index: "04", items: systems, blurb: "Architecture diagrams with the data flowing between components." },
] as const;

export const aboutEntry = { id: "about", title: "About", index: "05", blurb: "Who is behind the core." } as const;
