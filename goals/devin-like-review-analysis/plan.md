# Solution Approach

Introduce a session-scoped review-analysis layer beside the existing diff, agent-job, and external-annotation systems. The first slice keeps default review behavior unchanged, adds `--auto-run-analysis` as the opt-in entrypoint, converts Code Tour output into ordered review sections, converts review-agent findings into first-class findings, and wires those objects into the review sidebar, contextual chat, and diff navigation.

# Ordered Steps

1. Add the CLI/session flag boundary.
   - Touch `packages/shared/review-args.ts`, `packages/shared/review-args.test.ts`, `apps/hook/server/index.ts`, and any Pi/OpenCode review entrypoints that construct `ReviewServerOptions`.
   - Parse `--auto-run-analysis` into `ParsedReviewArgs`.
   - Pass an explicit review-analysis option into `startReviewServer`.
   - Keep no-flag behavior equivalent from the user's perspective.
   - Verification: `bun test packages/shared/review-args.test.ts` and a manual `plannotator review --help` check that the new flag is discoverable.

2. Define the shared review-analysis contract.
   - Add a shared module such as `packages/shared/review-analysis.ts`.
   - Model `ReviewAnalysis`, `ReviewAnalysisOverview`, `ReviewAnalysisSection`, `ReviewFinding`, `ReviewFindingStatus`, `ReviewFindingKind`, `ReviewAnalysisConfig`, and SSE/polling event types.
   - Include an `analysisConfig` shape now, with default values for Codex `gpt-5.5` reasoning `high` and Claude fallback `claude-opus-4-7` effort `high`.
   - Keep the contract independent from `CodeAnnotation`; findings can reference inline locations without becoming human annotations.
   - Verification: add shared unit tests for defaults, status transitions, and tour/finding transform helpers.

3. Add Bun and Pi review-analysis endpoints.
   - Add a Bun handler in `packages/server/` mirroring the shape of `external-annotations.ts` and `agent-jobs.ts`.
   - Add the matching Node/Pi handler under `apps/pi-extension/server/`.
   - Mount both handlers in `packages/server/review.ts` and `apps/pi-extension/server/serverReview.ts`.
   - Endpoint shape should support snapshot, SSE stream, analysis updates, finding status updates, and manual run requests.
   - Store analysis in memory for the current review server session only.
   - Verification: endpoint tests for snapshot, SSE event serialization, finding `PATCH`, and parity between Bun/Pi handler behavior where practical.

4. Make agent jobs populate analysis.
   - Factor a small internal launch helper out of `createAgentJobHandler`, or add a narrow server-side helper that auto-analysis can call after `serverUrl` is bound.
   - On `--auto-run-analysis`, start Code Tour plus the default review job automatically.
   - Use Codex `gpt-5.5` reasoning `high` for review findings when available; fall back to Claude `claude-opus-4-7` effort `high`.
   - Preserve manual `Run` behavior in `AgentsTab`.
   - Verification: server tests with mocked command builders proving auto-run starts the expected jobs and respects provider fallback.

5. Transform Code Tour output into sections.
   - Reuse `packages/shared/tour.ts` types and `packages/server/tour/tour-review.ts` output.
   - Map the tour overview into analysis overview fields.
   - Map each tour stop into an ordered section with title, explanation, files, additions, deletions, and anchors.
   - Derive section file stats from the parsed diff data rather than trusting the model.
   - Keep the existing Tour dialog available, but stop treating it as the only place tour output is useful.
   - Verification: transform tests using representative tour output with multiple anchors, missing hunks, and repeated files.

6. Transform review-agent findings into first-class findings.
   - Extend the current Codex and Claude completion paths in `packages/server/review.ts` and `apps/pi-extension/server/serverReview.ts`.
   - Continue emitting external annotations for inline rendering where useful.
   - Also create `ReviewFinding` objects with kind, severity, confidence, source job, file range, text, status, and related section when known.
   - Use `bug` for high-confidence blocking issues, `investigate` for lower-confidence or important review questions, and `note` for informational findings.
   - Verification: tests for Codex and Claude transform paths, including empty findings and multi-PR context metadata.

7. Add a review-analysis client hook.
   - Add a hook in the review editor mirroring `useExternalAnnotations` and `useAgentJobs`.
   - Fetch `/api/review-analysis`, subscribe to `/api/review-analysis/stream`, and expose actions for run analysis, run review, update finding status, and clear/reset if needed.
   - Wire the hook into `packages/review-editor/App.tsx` and `ReviewStateContext`.
   - Verification: component/hook tests for snapshot, add/update events, and optimistic status updates.

8. Add the section-first left navigation.
   - Keep `FileTree` intact for the default mode.
   - Add a sibling or wrapper component that can toggle between Files and Sections when analysis mode is active.
   - Default to Sections only when `--auto-run-analysis` starts the session.
   - Show empty-state actions when analysis mode is available but no sections exist yet.
   - Section rows should show grouped files, aggregate additions/deletions, read-explanation affordance, and hunk links.
   - Anchor clicks should reuse existing diff navigation helpers to open the right file and scroll to the line range.
   - Verification: local browser check for no-flag default, flag-enabled empty state, populated sections, Files toggle, and anchor navigation.

9. Replace the top-level right-sidebar model with Info / Chat / Agents for analysis mode.
   - Keep current Annotations / AI / Review Agents behavior outside analysis mode.
   - In analysis mode, show Info, Chat, and Agents labels.
   - Info should combine human comments and findings while preserving human annotation export behavior.
   - Findings should group by Bug, Investigate, and Note and expose copy, copy all, resolve, dismiss, ask, and post-to-platform actions where supported.
   - Hide post-to-platform actions in local diff mode.
   - Verification: UI checks for PR mode and local mode, including status changes and platform action visibility.

10. Make chat context-addressable.
   - Extend `useAIChat` request context to accept `review`, `section`, `finding`, `comment`, and `lineRange` refs.
   - Add context chips to the Chat tab for section/finding/comment entrypoints.
   - Make "Ask about this" from a finding or section produce an explicit context ref in the prompt/session request.
   - Keep existing selected-line Ask AI behavior working.
   - Verification: hook/unit tests for prompt construction plus browser checks for selected section/finding chips.

11. Document and build the first slice.
   - Update command docs for `plannotator review --auto-run-analysis`.
   - Update code-review docs to explain analysis mode, default providers, and local-vs-PR behavior.
   - Rebuild review UI before hook/opencode builds when UI changes are complete.
   - Verification: `bun run typecheck`, relevant `bun test ...` targets, `bun run build:review`, and `bun run build:hook`.

# Risks And Open Questions

- Auto-run needs a clean internal job-launch path. Calling the HTTP handler from inside the server would work, but factoring a small launch helper is cleaner and easier to test.
- `@pierre/diffs` usage is sensitive. Prefer reusing existing diff navigation and `DiffHunkPreview` paths; if `DiffViewer.tsx`, shadow-DOM selectors, unsafe CSS, or `FileDiff` props are touched, run the Pierre guard workflow before merging.
- Finding-to-section association may be fuzzy on the first slice. Start with file/range overlap against section anchors, then allow `relatedSectionId` to be null.
- The first slice should not persist analysis across server restarts. Do not accidentally store findings in drafts or saved review feedback.
- Provider defaults for auto-run should be server-side, not browser-cookie dependent.
- PR platform posting must preserve the existing layer/full-stack safety checks before comments are submitted.
