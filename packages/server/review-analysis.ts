import {
  createReviewAnalysisStore,
  isReviewFindingStatus,
  serializeReviewAnalysisSSEEvent,
  REVIEW_ANALYSIS_HEARTBEAT_COMMENT,
  REVIEW_ANALYSIS_HEARTBEAT_INTERVAL_MS,
  type ReviewAnalysis,
  type ReviewAnalysisEvent,
  type ReviewAnalysisStore,
  type ReviewFinding,
} from "@plannotator/shared/review-analysis";

export interface ReviewAnalysisHandler {
  handle: (
    req: Request,
    url: URL,
    options?: { disableIdleTimeout?: () => void },
  ) => Promise<Response | null>;
  getAnalysis: () => ReviewAnalysis;
  setRunState: ReviewAnalysisStore["setRunState"];
  setTourResult: ReviewAnalysisStore["setTourResult"];
  addFindings: ReviewAnalysisStore["addFindings"];
  updateFindingStatus: ReviewAnalysisStore["updateFindingStatus"];
}

const BASE = "/api/review-analysis";
const STREAM = `${BASE}/stream`;
const RUN = `${BASE}/run`;

export function createReviewAnalysisHandler(options?: {
  autoRun?: boolean;
  run?: (kind: "analysis" | "review" | "all") => Promise<unknown>;
}): ReviewAnalysisHandler {
  const store = createReviewAnalysisStore({ autoRun: options?.autoRun });
  const subscribers = new Set<ReadableStreamDefaultController>();
  const encoder = new TextEncoder();

  store.onMutation((event: ReviewAnalysisEvent) => {
    const data = encoder.encode(serializeReviewAnalysisSSEEvent(event));
    for (const controller of subscribers) {
      try {
        controller.enqueue(data);
      } catch {
        subscribers.delete(controller);
      }
    }
  });

  return {
    getAnalysis: store.get,
    setRunState: store.setRunState,
    setTourResult: store.setTourResult,
    addFindings: store.addFindings,
    updateFindingStatus: store.updateFindingStatus,

    async handle(req, url, handlerOptions) {
      if (url.pathname === STREAM && req.method === "GET") {
        handlerOptions?.disableIdleTimeout?.();

        let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
        let ctrl: ReadableStreamDefaultController;

        const stream = new ReadableStream({
          start(controller) {
            ctrl = controller;
            controller.enqueue(encoder.encode(serializeReviewAnalysisSSEEvent({
              type: "snapshot",
              analysis: store.get(),
              version: store.version,
            })));
            subscribers.add(controller);
            heartbeatTimer = setInterval(() => {
              try {
                controller.enqueue(encoder.encode(REVIEW_ANALYSIS_HEARTBEAT_COMMENT));
              } catch {
                if (heartbeatTimer) clearInterval(heartbeatTimer);
                subscribers.delete(controller);
              }
            }, REVIEW_ANALYSIS_HEARTBEAT_INTERVAL_MS);
          },
          cancel() {
            if (heartbeatTimer) clearInterval(heartbeatTimer);
            subscribers.delete(ctrl);
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }

      if (url.pathname === BASE && req.method === "GET") {
        const since = url.searchParams.get("since");
        if (since !== null) {
          const sinceVersion = parseInt(since, 10);
          if (!isNaN(sinceVersion) && sinceVersion === store.version) {
            return new Response(null, { status: 304 });
          }
        }
        return Response.json({ analysis: store.get(), version: store.version });
      }

      if (url.pathname === RUN && req.method === "POST") {
        if (!options?.run) return Response.json({ error: "Analysis runners unavailable" }, { status: 400 });
        try {
          const body = await req.json().catch(() => ({}));
          const kind = body.kind === "analysis" || body.kind === "review" || body.kind === "all"
            ? body.kind
            : "all";
          const result = await options.run(kind);
          return Response.json({ ok: true, result });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Failed to run analysis";
          return Response.json({ error: message }, { status: 500 });
        }
      }

      if (url.pathname === BASE && req.method === "PATCH") {
        const id = url.searchParams.get("id");
        if (!id) return Response.json({ error: "Missing ?id parameter" }, { status: 400 });
        try {
          const body = await req.json() as Partial<ReviewFinding>;
          if (!isReviewFindingStatus(body.status)) {
            return Response.json({ error: "Invalid finding status" }, { status: 400 });
          }
          const finding = store.updateFindingStatus(id, body.status);
          if (!finding) return Response.json({ error: "Not found" }, { status: 404 });
          return Response.json({ finding });
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
      }

      return null;
    },
  };
}
