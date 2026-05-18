import { describe, expect, test } from "bun:test";
import { createReviewAnalysisHandler } from "./review-analysis";
import { transformClaudeFindingsToReviewFindings } from "@plannotator/shared/review-analysis";

describe("review analysis handler", () => {
  test("returns a snapshot and runs manual analysis requests", async () => {
    const calls: string[] = [];
    const handler = createReviewAnalysisHandler({
      run: async (kind) => {
        calls.push(kind);
        return { ok: true };
      },
    });

    const snapshot = await handler.handle(new Request("http://x/api/review-analysis"), new URL("http://x/api/review-analysis"));
    expect(snapshot?.status).toBe(200);
    expect(await snapshot?.json()).toMatchObject({
      analysis: { autoRun: false, sections: [], findings: [] },
      version: 0,
    });

    const run = await handler.handle(
      new Request("http://x/api/review-analysis/run", {
        method: "POST",
        body: JSON.stringify({ kind: "analysis" }),
      }),
      new URL("http://x/api/review-analysis/run"),
    );
    expect(run?.status).toBe(200);
    expect(calls).toEqual(["analysis"]);
  });

  test("patches finding status in the current session", async () => {
    const handler = createReviewAnalysisHandler();
    const [finding] = transformClaudeFindingsToReviewFindings([{
      severity: "important",
      file: "src/a.ts",
      line: 2,
      description: "Bug",
    }], { source: "agent-1" });
    handler.addFindings([finding]);

    const res = await handler.handle(
      new Request(`http://x/api/review-analysis?id=${finding.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "dismissed" }),
      }),
      new URL(`http://x/api/review-analysis?id=${finding.id}`),
    );

    expect(res?.status).toBe(200);
    expect(handler.getAnalysis().findings[0].status).toBe("dismissed");
  });
});
