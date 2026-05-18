# Devin-Like Review Analysis

Extend Plannotator code review with an opt-in Devin-like analysis experience: `plannotator review --auto-run-analysis` starts a session-scoped analysis pipeline, promotes Code Tour output into section-first navigation, promotes agent review output into stateful findings, and lets chat target review context such as sections, findings, comments, and line ranges.

The shared understanding is in `facts.md`.

The execution plan is in `plan.md`.

Done when default review behavior remains unchanged without the flag, analysis mode works for PR and local diff reviews, sections and findings populate from local agents, Info/Chat/Agents are wired into the review surface, and the documented verification commands pass.
