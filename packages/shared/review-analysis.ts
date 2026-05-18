import type { CodeTourOutput, TourDiffAnchor } from "./tour";

export type ReviewFindingKind = "bug" | "investigate" | "note";
export type ReviewFindingSeverity = "critical" | "high" | "medium" | "low";
export type ReviewFindingStatus = "open" | "resolved" | "dismissed" | "posted";
export type ReviewFindingSide = "old" | "new";

export interface ReviewAnalysisConfig {
  primary: {
    provider: "codex";
    model: string;
    reasoningEffort: string;
  };
  fallback: {
    provider: "claude";
    model: string;
    effort: string;
  };
}

export const DEFAULT_REVIEW_ANALYSIS_CONFIG: ReviewAnalysisConfig = {
  primary: { provider: "codex", model: "gpt-5.5", reasoningEffort: "high" },
  fallback: { provider: "claude", model: "claude-opus-4-7", effort: "high" },
};

export interface ReviewAnalysisOverview {
  title: string;
  summary: string;
  before: string;
  after: string;
  keyTakeaways: string[];
}

export interface ReviewAnalysisAnchor {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  label?: string;
  hunk?: string;
}

export interface ReviewAnalysisSection {
  id: string;
  order: number;
  title: string;
  explanation: string;
  files: string[];
  additions: number;
  deletions: number;
  anchors: ReviewAnalysisAnchor[];
}

export interface ReviewFinding {
  id: string;
  kind: ReviewFindingKind;
  severity: ReviewFindingSeverity;
  confidence: number;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  side: ReviewFindingSide;
  text: string;
  sourceAgent: string;
  sourceJobId?: string;
  source?: string;
  status: ReviewFindingStatus;
  relatedSectionId?: string | null;
  createdAt: number;
}

export interface ReviewAnalysis {
  autoRun: boolean;
  overview: ReviewAnalysisOverview | null;
  sections: ReviewAnalysisSection[];
  findings: ReviewFinding[];
  isRunningAnalysis: boolean;
  isRunningReview: boolean;
  analysisConfig: ReviewAnalysisConfig;
}

export type ReviewAnalysisEvent =
  | { type: "snapshot"; analysis: ReviewAnalysis; version: number }
  | { type: "update"; analysis: ReviewAnalysis; version: number }
  | { type: "finding:updated"; finding: ReviewFinding; analysis: ReviewAnalysis; version: number };

type ReviewAnalysisStoreEvent =
  | { type: "snapshot"; analysis: ReviewAnalysis }
  | { type: "update"; analysis: ReviewAnalysis }
  | { type: "finding:updated"; finding: ReviewFinding; analysis: ReviewAnalysis };

export type ReviewChatContextRef =
  | { type: "review" }
  | { type: "section"; sectionId: string; title: string; files: string[] }
  | { type: "finding"; findingId: string; title: string; filePath: string; lineStart: number; lineEnd: number; status: ReviewFindingStatus }
  | { type: "comment"; commentId: string; filePath: string; lineStart: number; lineEnd: number; text: string }
  | { type: "lineRange"; filePath: string; lineStart: number; lineEnd: number; side: ReviewFindingSide };

export const REVIEW_ANALYSIS_HEARTBEAT_COMMENT = ":\n\n";
export const REVIEW_ANALYSIS_HEARTBEAT_INTERVAL_MS = 30_000;

export function serializeReviewAnalysisSSEEvent(event: ReviewAnalysisEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function isReviewFindingStatus(value: unknown): value is ReviewFindingStatus {
  return value === "open" || value === "resolved" || value === "dismissed" || value === "posted";
}

export function transitionReviewFindingStatus(
  finding: ReviewFinding,
  status: ReviewFindingStatus,
): ReviewFinding {
  return { ...finding, status };
}

export interface ReviewAnalysisStore {
  get version(): number;
  get: () => ReviewAnalysis;
  onMutation: (listener: (event: ReviewAnalysisEvent) => void) => () => void;
  setRunState: (state: Partial<Pick<ReviewAnalysis, "isRunningAnalysis" | "isRunningReview">>) => ReviewAnalysis;
  setTourResult: (tour: CodeTourOutput, patch?: string) => ReviewAnalysis;
  addFindings: (findings: ReviewFinding[]) => ReviewAnalysis;
  updateFindingStatus: (id: string, status: ReviewFindingStatus) => ReviewFinding | null;
  clear: () => ReviewAnalysis;
}

export function createReviewAnalysisStore(options?: {
  autoRun?: boolean;
  analysisConfig?: ReviewAnalysisConfig;
}): ReviewAnalysisStore {
  let version = 0;
  let analysis = createEmptyReviewAnalysis(options);
  const listeners = new Set<(event: ReviewAnalysisEvent) => void>();

  function emit(event: ReviewAnalysisStoreEvent) {
    version++;
    const fullEvent = { ...event, version } as ReviewAnalysisEvent;
    for (const listener of listeners) listener(fullEvent);
  }

  function replace(next: ReviewAnalysis): ReviewAnalysis {
    analysis = next;
    emit({ type: "update", analysis });
    return analysis;
  }

  return {
    get version() {
      return version;
    },
    get: () => analysis,
    onMutation(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setRunState(state) {
      return replace({ ...analysis, ...state });
    },
    setTourResult(tour, patch) {
      const transformed = transformCodeTourToReviewAnalysis(tour, patch);
      return replace({
        ...analysis,
        ...transformed,
        isRunningAnalysis: false,
      });
    },
    addFindings(findings) {
      if (findings.length === 0) return replace({ ...analysis, isRunningReview: false });
      const existing = new Set(analysis.findings.map((finding) => finding.id));
      return replace({
        ...analysis,
        findings: [...analysis.findings, ...findings.filter((finding) => !existing.has(finding.id))],
        isRunningReview: false,
      });
    },
    updateFindingStatus(id, status) {
      const finding = analysis.findings.find((item) => item.id === id);
      if (!finding) return null;
      const updated = transitionReviewFindingStatus(finding, status);
      analysis = {
        ...analysis,
        findings: analysis.findings.map((item) => item.id === id ? updated : item),
      };
      emit({ type: "finding:updated", finding: updated, analysis });
      return updated;
    },
    clear() {
      return replace(createEmptyReviewAnalysis(options));
    },
  };
}

export function createEmptyReviewAnalysis(options?: {
  autoRun?: boolean;
  analysisConfig?: ReviewAnalysisConfig;
}): ReviewAnalysis {
  return {
    autoRun: options?.autoRun === true,
    overview: null,
    sections: [],
    findings: [],
    isRunningAnalysis: false,
    isRunningReview: false,
    analysisConfig: options?.analysisConfig ?? DEFAULT_REVIEW_ANALYSIS_CONFIG,
  };
}

export function transformCodeTourToReviewAnalysis(
  tour: CodeTourOutput,
  patch?: string,
): Pick<ReviewAnalysis, "overview" | "sections"> {
  const stats = patch ? parseDiffStats(patch) : new Map<string, { additions: number; deletions: number }>();

  return {
    overview: {
      title: tour.title,
      summary: tour.greeting || tour.intent,
      before: tour.before,
      after: tour.after,
      keyTakeaways: tour.key_takeaways.map((item) => item.text).filter(Boolean),
    },
    sections: tour.stops.map((stop, index) => {
      const anchors = stop.anchors.map(toAnalysisAnchor);
      const files = [...new Set(anchors.map((anchor) => anchor.filePath))];
      const totals = files.reduce(
        (sum, file) => {
          const fileStats = stats.get(file);
          return {
            additions: sum.additions + (fileStats?.additions ?? 0),
            deletions: sum.deletions + (fileStats?.deletions ?? 0),
          };
        },
        { additions: 0, deletions: 0 },
      );

      return {
        id: stableSectionId(stop.title, index),
        order: index,
        title: stop.title,
        explanation: [stop.gist, stop.detail].filter(Boolean).join("\n\n"),
        files,
        additions: totals.additions,
        deletions: totals.deletions,
        anchors,
      };
    }),
  };
}

export function transformCodexFindingsToReviewFindings(
  findings: Array<{
    title: string;
    body: string;
    confidence_score: number;
    priority: number | null;
    code_location: {
      absolute_file_path: string;
      line_range: { start: number; end: number };
    };
  }>,
  options: {
    source: string;
    cwd?: string;
    sourceAgent?: string;
    sourceJobId?: string;
    sections?: ReviewAnalysisSection[];
  },
): ReviewFinding[] {
  return findings
    .filter((finding) =>
      finding.code_location?.absolute_file_path &&
      typeof finding.code_location.line_range?.start === "number" &&
      typeof finding.code_location.line_range?.end === "number"
    )
    .map((finding, index) => {
      const filePath = toRelativePath(finding.code_location.absolute_file_path, options.cwd);
      const lineStart = finding.code_location.line_range.start;
      const lineEnd = finding.code_location.line_range.end;
      const priority = finding.priority;
      return {
        id: stableFindingId(options.source, filePath, lineStart, lineEnd, index),
        kind: priority !== null && priority <= 1 ? "bug" : priority === 2 ? "investigate" : "note",
        severity: priorityToSeverity(priority),
        confidence: finding.confidence_score,
        filePath,
        lineStart,
        lineEnd,
        side: "new",
        text: `${finding.title}\n\n${finding.body}`.trim(),
        sourceAgent: options.sourceAgent ?? "Codex",
        sourceJobId: options.sourceJobId,
        source: options.source,
        status: "open",
        relatedSectionId: findRelatedSection(options.sections, filePath, lineStart, lineEnd),
        createdAt: Date.now(),
      } satisfies ReviewFinding;
    });
}

export function transformClaudeFindingsToReviewFindings(
  findings: Array<{
    severity: "important" | "nit" | "pre_existing";
    file: string;
    line: number;
    end_line?: number;
    description: string;
    reasoning?: string;
  }>,
  options: {
    source: string;
    cwd?: string;
    sourceAgent?: string;
    sourceJobId?: string;
    sections?: ReviewAnalysisSection[];
  },
): ReviewFinding[] {
  return findings
    .filter((finding) => finding.file && typeof finding.line === "number")
    .map((finding, index) => {
      const filePath = toRelativePath(finding.file, options.cwd);
      const lineStart = finding.line;
      const lineEnd = finding.end_line ?? finding.line;
      return {
        id: stableFindingId(options.source, filePath, lineStart, lineEnd, index),
        kind: finding.severity === "important" ? "bug" : finding.severity === "nit" ? "investigate" : "note",
        severity: finding.severity === "important" ? "high" : finding.severity === "nit" ? "medium" : "low",
        confidence: finding.severity === "important" ? 0.9 : finding.severity === "nit" ? 0.7 : 0.6,
        filePath,
        lineStart,
        lineEnd,
        side: "new",
        text: [finding.description, finding.reasoning && `Reasoning: ${finding.reasoning}`].filter(Boolean).join("\n\n"),
        sourceAgent: options.sourceAgent ?? "Claude Code",
        sourceJobId: options.sourceJobId,
        source: options.source,
        status: "open",
        relatedSectionId: findRelatedSection(options.sections, filePath, lineStart, lineEnd),
        createdAt: Date.now(),
      } satisfies ReviewFinding;
    });
}

function toAnalysisAnchor(anchor: TourDiffAnchor): ReviewAnalysisAnchor {
  return {
    filePath: anchor.file,
    lineStart: anchor.line,
    lineEnd: anchor.end_line,
    label: anchor.label,
    hunk: anchor.hunk,
  };
}

function parseDiffStats(rawPatch: string): Map<string, { additions: number; deletions: number }> {
  const stats = new Map<string, { additions: number; deletions: number }>();
  for (const chunk of rawPatch.split(/^diff --git /m).filter(Boolean)) {
    const lines = chunk.split("\n");
    const header = lines[0]?.match(/a\/(.+) b\/(.+)/);
    if (!header) continue;
    const filePath = header[2];
    let additions = 0;
    let deletions = 0;
    for (const line of lines) {
      if (line.startsWith("+") && !line.startsWith("+++")) additions++;
      if (line.startsWith("-") && !line.startsWith("---")) deletions++;
    }
    stats.set(filePath, { additions, deletions });
  }
  return stats;
}

function findRelatedSection(
  sections: ReviewAnalysisSection[] | undefined,
  filePath: string,
  lineStart: number,
  lineEnd: number,
): string | null {
  if (!sections) return null;
  const exact = sections.find((section) =>
    section.anchors.some((anchor) =>
      anchor.filePath === filePath &&
      anchor.lineStart <= lineEnd &&
      anchor.lineEnd >= lineStart
    )
  );
  if (exact) return exact.id;
  return sections.find((section) => section.files.includes(filePath))?.id ?? null;
}

function priorityToSeverity(priority: number | null): ReviewFindingSeverity {
  if (priority === 0) return "critical";
  if (priority === 1) return "high";
  if (priority === 2) return "medium";
  return "low";
}

function toRelativePath(filePath: string, cwd?: string): string {
  if (!cwd) return filePath.replace(/\\/g, "/");
  const normalizedPath = filePath.replace(/\\/g, "/");
  const normalizedCwd = cwd.replace(/\\/g, "/").replace(/\/$/, "");
  return normalizedPath.startsWith(`${normalizedCwd}/`)
    ? normalizedPath.slice(normalizedCwd.length + 1)
    : normalizedPath;
}

function stableSectionId(title: string, index: number): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `section-${index + 1}${slug ? `-${slug}` : ""}`;
}

function stableFindingId(source: string, filePath: string, lineStart: number, lineEnd: number, index: number): string {
  const text = `${source}:${filePath}:${lineStart}:${lineEnd}:${index}`;
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return `finding-${Math.abs(hash).toString(36)}`;
}
