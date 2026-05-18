import { describe, expect, test } from "bun:test";
import {
  DEFAULT_REVIEW_ANALYSIS_CONFIG,
  createReviewAnalysisStore,
  transformClaudeFindingsToReviewFindings,
  transformCodeTourToReviewAnalysis,
  transformCodexFindingsToReviewFindings,
} from "./review-analysis";

const patch = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1 +1,2 @@",
  "-old",
  "+new",
  "+next",
  "diff --git a/src/b.ts b/src/b.ts",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -4 +4 @@",
  "-remove",
  "+add",
].join("\n");

describe("review analysis", () => {
  test("uses server-side default provider config", () => {
    expect(DEFAULT_REVIEW_ANALYSIS_CONFIG).toEqual({
      primary: { provider: "codex", model: "gpt-5.5", reasoningEffort: "high" },
      fallback: { provider: "claude", model: "claude-opus-4-7", effort: "high" },
    });
  });

  test("maps tour output into overview and ordered sections with diff stats", () => {
    const analysis = transformCodeTourToReviewAnalysis({
      title: "Review tour",
      greeting: "Here is the shape of the change.",
      intent: "Make review easier.",
      before: "Files were only listed.",
      after: "Sections explain the change.",
      key_takeaways: [{ text: "Start with the analysis.", severity: "info" }],
      stops: [
        {
          title: "UI shell",
          gist: "Adds the new shell.",
          detail: "The shell keeps files nearby.",
          transition: "",
          anchors: [{ file: "src/a.ts", line: 1, end_line: 2, hunk: "@@", label: "Shell" }],
        },
        {
          title: "Second piece",
          gist: "Adds the other file.",
          detail: "",
          transition: "",
          anchors: [{ file: "src/b.ts", line: 4, end_line: 4, hunk: "@@", label: "Other" }],
        },
      ],
      qa_checklist: [],
    }, patch);

    expect(analysis.overview?.title).toBe("Review tour");
    expect(analysis.sections.map((section) => section.title)).toEqual(["UI shell", "Second piece"]);
    expect(analysis.sections[0]).toMatchObject({
      files: ["src/a.ts"],
      additions: 2,
      deletions: 1,
    });
    expect(analysis.sections[1]).toMatchObject({
      files: ["src/b.ts"],
      additions: 1,
      deletions: 1,
    });
  });

  test("transforms agent findings and relates them to section anchors", () => {
    const { sections } = transformCodeTourToReviewAnalysis({
      title: "Tour",
      greeting: "",
      intent: "",
      before: "",
      after: "",
      key_takeaways: [],
      stops: [{
        title: "A file",
        gist: "",
        detail: "",
        transition: "",
        anchors: [{ file: "src/a.ts", line: 10, end_line: 20, hunk: "", label: "" }],
      }],
      qa_checklist: [],
    });

    const codex = transformCodexFindingsToReviewFindings([{
      title: "[P1] Broken condition",
      body: "This condition now accepts invalid input.",
      confidence_score: 0.92,
      priority: 1,
      code_location: {
        absolute_file_path: "/repo/src/a.ts",
        line_range: { start: 12, end: 12 },
      },
    }], { source: "agent-1", cwd: "/repo", sourceJobId: "job-1", sections });

    const claude = transformClaudeFindingsToReviewFindings([{
      severity: "nit",
      file: "/repo/src/b.ts",
      line: 3,
      end_line: 3,
      description: "Consider clarifying this.",
      reasoning: "The name is ambiguous.",
    }], { source: "agent-2", cwd: "/repo", sourceJobId: "job-2", sections });

    expect(codex[0]).toMatchObject({
      kind: "bug",
      severity: "high",
      filePath: "src/a.ts",
      relatedSectionId: sections[0].id,
      status: "open",
    });
    expect(claude[0]).toMatchObject({
      kind: "investigate",
      severity: "medium",
      filePath: "src/b.ts",
      relatedSectionId: null,
      status: "open",
    });
  });

  test("stores session-scoped status transitions", () => {
    const store = createReviewAnalysisStore();
    const [finding] = transformClaudeFindingsToReviewFindings([{
      severity: "important",
      file: "src/a.ts",
      line: 1,
      description: "A bug",
    }], { source: "agent-1" });

    store.addFindings([finding]);
    const updated = store.updateFindingStatus(finding.id, "resolved");

    expect(updated?.status).toBe("resolved");
    expect(store.get().findings[0].status).toBe("resolved");
  });
});
