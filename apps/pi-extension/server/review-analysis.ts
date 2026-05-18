import type { IncomingMessage, ServerResponse } from "node:http";
import {
	createReviewAnalysisStore,
	isReviewFindingStatus,
	serializeReviewAnalysisSSEEvent,
	REVIEW_ANALYSIS_HEARTBEAT_COMMENT,
	REVIEW_ANALYSIS_HEARTBEAT_INTERVAL_MS,
	type ReviewAnalysisEvent,
	type ReviewAnalysisStore,
	type ReviewFinding,
} from "../generated/review-analysis.js";
import { json, parseBody } from "./helpers.js";

const BASE = "/api/review-analysis";
const STREAM = `${BASE}/stream`;
const RUN = `${BASE}/run`;

export function createReviewAnalysisHandler(options?: {
	autoRun?: boolean;
	run?: (kind: "analysis" | "review" | "all") => Promise<unknown>;
}) {
	const store = createReviewAnalysisStore({ autoRun: options?.autoRun });
	const subscribers = new Set<ServerResponse>();

	store.onMutation((event: ReviewAnalysisEvent) => {
		const data = serializeReviewAnalysisSSEEvent(event);
		for (const res of subscribers) {
			try {
				res.write(data);
			} catch {
				subscribers.delete(res);
			}
		}
	});

	return {
		getAnalysis: store.get,
		setRunState: store.setRunState as ReviewAnalysisStore["setRunState"],
		setTourResult: store.setTourResult as ReviewAnalysisStore["setTourResult"],
		addFindings: store.addFindings as ReviewAnalysisStore["addFindings"],
		updateFindingStatus: store.updateFindingStatus as ReviewAnalysisStore["updateFindingStatus"],

		async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
			if (url.pathname === STREAM && req.method === "GET") {
				res.writeHead(200, {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					Connection: "keep-alive",
				});
				res.setTimeout(0);
				res.write(serializeReviewAnalysisSSEEvent({
					type: "snapshot",
					analysis: store.get(),
					version: store.version,
				}));
				subscribers.add(res);

				const heartbeatTimer = setInterval(() => {
					try {
						res.write(REVIEW_ANALYSIS_HEARTBEAT_COMMENT);
					} catch {
						clearInterval(heartbeatTimer);
						subscribers.delete(res);
					}
				}, REVIEW_ANALYSIS_HEARTBEAT_INTERVAL_MS);

				res.on("close", () => {
					clearInterval(heartbeatTimer);
					subscribers.delete(res);
				});
				return true;
			}

			if (url.pathname === BASE && req.method === "GET") {
				const since = url.searchParams.get("since");
				if (since !== null) {
					const sinceVersion = parseInt(since, 10);
					if (!isNaN(sinceVersion) && sinceVersion === store.version) {
						res.writeHead(304);
						res.end();
						return true;
					}
				}
				json(res, { analysis: store.get(), version: store.version });
				return true;
			}

			if (url.pathname === RUN && req.method === "POST") {
				if (!options?.run) {
					json(res, { error: "Analysis runners unavailable" }, 400);
					return true;
				}
				try {
					const body = (await parseBody(req).catch(() => ({}))) as Record<string, unknown>;
					const kind = body.kind === "analysis" || body.kind === "review" || body.kind === "all"
						? body.kind
						: "all";
					const result = await options.run(kind);
					json(res, { ok: true, result });
				} catch (err) {
					json(res, { error: err instanceof Error ? err.message : "Failed to run analysis" }, 500);
				}
				return true;
			}

			if (url.pathname === BASE && req.method === "PATCH") {
				const id = url.searchParams.get("id");
				if (!id) {
					json(res, { error: "Missing ?id parameter" }, 400);
					return true;
				}
				try {
					const body = await parseBody(req) as Partial<ReviewFinding>;
					if (!isReviewFindingStatus(body.status)) {
						json(res, { error: "Invalid finding status" }, 400);
						return true;
					}
					const finding = store.updateFindingStatus(id, body.status);
					if (!finding) {
						json(res, { error: "Not found" }, 404);
						return true;
					}
					json(res, { finding });
				} catch {
					json(res, { error: "Invalid JSON" }, 400);
				}
				return true;
			}

			return false;
		},
	};
}
