import React, { useState } from 'react';
import { CodeAnnotation, type EditorAnnotation } from '@plannotator/ui/types';
import { isCurrentUser } from '@plannotator/ui/utils/identity';
import { EditorAnnotationCard } from '@plannotator/ui/components/EditorAnnotationCard';
import { CopyButton } from './CopyButton';
import { ConventionalLabelBadge } from './ConventionalLabelPicker';
import { HighlightedCode } from './HighlightedCode';
import { detectLanguage } from '../utils/detectLanguage';
import { renderInlineMarkdown } from '../utils/renderInlineMarkdown';
import { formatRelativeTime } from '../utils/formatRelativeTime';
import { AITab } from './AITab';
import { AgentsTab } from '@plannotator/ui/components/AgentsTab';
import type { PRMetadata } from '@plannotator/shared/pr-types';
import { OverlayScrollArea } from '@plannotator/ui/components/OverlayScrollArea';
import type { AIChatEntry } from '../hooks/useAIChat';
import type { AgentJobInfo, AgentCapabilities } from '@plannotator/ui/types';
import type { DiffFile } from '../types';
import type { ReviewAnalysis, ReviewFinding, ReviewFindingKind, ReviewFindingStatus } from '@plannotator/shared/review-analysis';

export type ReviewSidebarTab = 'annotations' | 'ai' | 'agents';


interface ReviewSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: ReviewSidebarTab;
  annotations: CodeAnnotation[];
  files: DiffFile[];
  selectedAnnotationId: string | null;
  onSelectAnnotation: (id: string | null) => void;
  onDeleteAnnotation: (id: string) => void;
  feedbackMarkdown?: string;
  width?: number;
  editorAnnotations?: EditorAnnotation[];
  onDeleteEditorAnnotation?: (id: string) => void;
  prMetadata?: PRMetadata | null;
  // AI props
  aiAvailable?: boolean;
  aiMessages?: AIChatEntry[];
  isAICreatingSession?: boolean;
  isAIStreaming?: boolean;
  onScrollToAILines?: (filePath: string, lineStart: number, lineEnd: number, side: 'old' | 'new') => void;
  activeFilePath?: string;
  scrollToQuestionId?: string | null;
  onAskGeneral?: (question: string) => void;
  aiPermissionRequests?: import('../hooks/useAIChat').PendingPermission[];
  onRespondToPermission?: (requestId: string, allow: boolean) => void;
  aiProviders?: Array<{ id: string; name: string; models?: Array<{ id: string; label: string; default?: boolean }> }>;
  aiConfig?: { providerId: string | null; model: string | null; reasoningEffort?: string | null };
  onAIConfigChange?: (config: { providerId?: string | null; model?: string | null; reasoningEffort?: string | null }) => void;
  hasAISession?: boolean;
  // Agent props
  agentJobs?: AgentJobInfo[];
  agentCapabilities?: AgentCapabilities | null;
  onAgentLaunch?: (params: { provider?: string; command?: string[]; label?: string; engine?: string; model?: string; reasoningEffort?: string; effort?: string; fastMode?: boolean }) => void;
  onAgentKillJob?: (id: string) => void;
  onAgentKillAll?: () => void;
  externalAnnotations?: Array<{ source?: string }>;
  onOpenJobDetail?: (jobId: string) => void;
  onOpenPRPanel?: (type: 'summary' | 'comments' | 'checks') => void;
  analysisMode?: boolean;
  analysis?: ReviewAnalysis | null;
  onRunAnalysis?: () => void;
  onRunReview?: () => void;
  onUpdateFindingStatus?: (id: string, status: ReviewFindingStatus) => void;
  onAskFinding?: (finding: ReviewFinding) => void;
  onAskComment?: (annotation: CodeAnnotation) => void;
  onPostFinding?: (finding: ReviewFinding) => void;
}

const SuggestionPreview: React.FC<{ code: string; originalCode?: string; language?: string }> = ({ code, originalCode, language }) => {
  const diffStats = originalCode ? {
    removed: originalCode.split('\n').length,
    added: code.split('\n').length,
  } : null;

  return (
    <div className="suggestion-block compact">
      <div className="suggestion-block-header">
        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16m-7 6h7" />
        </svg>
        Suggestion
        {diffStats && (
          <span className="ml-auto text-[9px] font-mono">
            <span style={{ color: 'var(--success)' }}>+{diffStats.added}</span>
            {' '}
            <span style={{ color: 'var(--destructive)' }}>-{diffStats.removed}</span>
          </span>
        )}
      </div>
      <pre className="suggestion-block-code"><HighlightedCode code={code} language={language} /></pre>
    </div>
  );
};

const FILE_SCOPE_FIRST = { file: 0, line: 1 } as const;

function getAnnotationScope(annotation: CodeAnnotation): 'line' | 'file' {
  return annotation.scope ?? 'line';
}

function compareCodeAnnotations(a: CodeAnnotation, b: CodeAnnotation): number {
  const aScope = getAnnotationScope(a);
  const bScope = getAnnotationScope(b);

  if (aScope !== bScope) {
    return FILE_SCOPE_FIRST[aScope] - FILE_SCOPE_FIRST[bScope];
  }

  return aScope === 'file'
    ? b.createdAt - a.createdAt
    : a.lineStart - b.lineStart;
}

const FINDING_GROUPS: Array<{ kind: ReviewFindingKind; title: string }> = [
  { kind: 'bug', title: 'Bug' },
  { kind: 'investigate', title: 'Investigate' },
  { kind: 'note', title: 'Note' },
];

const STATUS_LABEL: Record<ReviewFindingStatus, string> = {
  open: 'Open',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
  posted: 'Posted',
};

const AnalysisInfoPanel: React.FC<{
  analysis: ReviewAnalysis | null;
  prMetadata?: PRMetadata | null;
  onRunAnalysis?: () => void;
  onRunReview?: () => void;
  onUpdateFindingStatus?: (id: string, status: ReviewFindingStatus) => void;
  onAskFinding?: (finding: ReviewFinding) => void;
  onPostFinding?: (finding: ReviewFinding) => void;
}> = ({
  analysis,
  prMetadata,
  onRunAnalysis,
  onRunReview,
  onUpdateFindingStatus,
  onAskFinding,
  onPostFinding,
}) => {
  const findings = analysis?.findings ?? [];
  const grouped = FINDING_GROUPS.map(group => ({
    ...group,
    findings: findings.filter(finding => finding.kind === group.kind),
  }));
  const copyAll = findings.map(findingToClipboardText).join('\n\n---\n\n');

  return (
    <div className="p-2 space-y-3">
      {analysis?.overview && (
        <div className="rounded border border-border/50 bg-muted/20 p-2.5">
          <div className="text-xs font-medium text-foreground line-clamp-1">{analysis.overview.title}</div>
          <p className="mt-1 text-xs text-muted-foreground line-clamp-3">{analysis.overview.summary}</p>
          {analysis.overview.keyTakeaways.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {analysis.overview.keyTakeaways.slice(0, 3).map((takeaway, index) => (
                <span key={index} className="max-w-full truncate text-[10px] text-muted-foreground bg-background/60 border border-border/40 rounded px-1.5 py-0.5">
                  {takeaway}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {findings.length === 0 ? (
        <div className="rounded border border-border/40 bg-muted/10 p-3 text-center">
          <p className="text-xs text-muted-foreground mb-2">
            {analysis?.isRunningReview ? 'Review agent is running...' : 'No agent findings yet.'}
          </p>
          <div className="flex items-center justify-center gap-2">
            {onRunAnalysis && (
              <button
                onClick={onRunAnalysis}
                disabled={analysis?.isRunningAnalysis}
                className="px-2 py-1 rounded text-[10px] font-medium bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                {analysis?.isRunningAnalysis ? 'Running...' : 'Run analysis'}
              </button>
            )}
            {onRunReview && (
              <button
                onClick={onRunReview}
                disabled={analysis?.isRunningReview}
                className="px-2 py-1 rounded text-[10px] font-medium bg-primary text-primary-foreground disabled:opacity-50"
              >
                {analysis?.isRunningReview ? 'Running...' : 'Run review'}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Agent findings
            </span>
            <CopyButton text={copyAll} variant="inline" label="Copy all" />
          </div>
          {grouped.map(group => group.findings.length > 0 && (
            <div key={group.kind} className="space-y-1.5">
              <div className="flex items-center gap-2 px-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                  {group.title}
                </span>
                <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                  {group.findings.length}
                </span>
              </div>
              {group.findings.map(finding => (
                <FindingCard
                  key={finding.id}
                  finding={finding}
                  canPost={!!prMetadata}
                  onStatus={onUpdateFindingStatus}
                  onAsk={onAskFinding}
                  onPost={onPostFinding}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const FindingCard: React.FC<{
  finding: ReviewFinding;
  canPost: boolean;
  onStatus?: (id: string, status: ReviewFindingStatus) => void;
  onAsk?: (finding: ReviewFinding) => void;
  onPost?: (finding: ReviewFinding) => void;
}> = ({ finding, canPost, onStatus, onAsk, onPost }) => (
  <div className={`group rounded border p-2.5 transition-colors ${
    finding.status === 'open'
      ? 'border-border/60 bg-card/40 hover:bg-muted/20'
      : 'border-border/30 bg-muted/10 opacity-70'
  }`}>
    <div className="flex items-center gap-2 mb-1.5">
      <span className="text-[10px] font-mono text-muted-foreground">
        {finding.filePath.split('/').pop()}:{finding.lineStart}
      </span>
      <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
        {finding.severity}
      </span>
      <span className="ml-auto text-[9px] text-muted-foreground/60">
        {STATUS_LABEL[finding.status]}
      </span>
    </div>
    <p className="text-xs text-foreground/85 whitespace-pre-line line-clamp-4">{finding.text}</p>
    <div className="mt-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <CopyButton text={findingToClipboardText(finding)} variant="inline" />
      <button
        onClick={() => onAsk?.(finding)}
        className="px-1.5 py-0.5 rounded text-[10px] text-muted-foreground hover:text-accent hover:bg-accent/10 transition-colors"
      >
        Ask
      </button>
      {finding.status !== 'resolved' && (
        <button
          onClick={() => onStatus?.(finding.id, 'resolved')}
          className="px-1.5 py-0.5 rounded text-[10px] text-muted-foreground hover:text-success hover:bg-success/10 transition-colors"
        >
          Resolve
        </button>
      )}
      {finding.status !== 'dismissed' && (
        <button
          onClick={() => onStatus?.(finding.id, 'dismissed')}
          className="px-1.5 py-0.5 rounded text-[10px] text-muted-foreground hover:text-warning hover:bg-warning/10 transition-colors"
        >
          Dismiss
        </button>
      )}
      {canPost && finding.status !== 'posted' && (
        <button
          onClick={() => onPost?.(finding)}
          className="ml-auto px-1.5 py-0.5 rounded text-[10px] text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
        >
          Post
        </button>
      )}
    </div>
  </div>
);

function findingToClipboardText(finding: ReviewFinding): string {
  return [
    `${finding.filePath}:${finding.lineStart}${finding.lineEnd !== finding.lineStart ? `-${finding.lineEnd}` : ''}`,
    `[${finding.kind}/${finding.severity}/${finding.status}] ${finding.text}`,
    `Source: ${finding.sourceAgent} · confidence ${Math.round(finding.confidence * 100)}%`,
  ].join('\n');
}


export const ReviewSidebar: React.FC<ReviewSidebarProps> = /* React.memo */({
  isOpen,
  onClose,
  activeTab,
  annotations,
  files,
  selectedAnnotationId,
  onSelectAnnotation,
  onDeleteAnnotation,
  feedbackMarkdown,
  width,
  editorAnnotations,
  onDeleteEditorAnnotation,
  prMetadata,
  aiAvailable = false,
  aiMessages = [],
  isAICreatingSession = false,
  isAIStreaming = false,
  onScrollToAILines,
  activeFilePath,
  scrollToQuestionId,
  onAskGeneral,
  aiPermissionRequests = [],
  onRespondToPermission,
  aiProviders,
  aiConfig,
  onAIConfigChange,
  hasAISession,
  agentJobs,
  agentCapabilities,
  onAgentLaunch,
  onAgentKillJob,
  onAgentKillAll,
  externalAnnotations,
  onOpenJobDetail,
  onOpenPRPanel,
  analysisMode = false,
  analysis,
  onRunAnalysis,
  onRunReview,
  onUpdateFindingStatus,
  onAskFinding,
  onAskComment,
  onPostFinding,
}) => {
  const findingCount = analysis?.findings.length ?? 0;
  const visibleAnnotations = analysisMode ? annotations.filter(annotation => !annotation.source) : annotations;
  const totalCount = visibleAnnotations.length + (editorAnnotations?.length ?? 0) + (analysisMode ? findingCount : 0);
  const [copied, setCopied] = useState(false);

  const handleQuickCopy = async () => {
    if (!feedbackMarkdown) return;
    try {
      await navigator.clipboard.writeText(feedbackMarkdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy:', e);
    }
  };

  // Group annotations by file, optionally by PR first
  const { groupedAnnotations, prGroups, isMultiPR } = React.useMemo(() => {
    const prUrls = new Set(visibleAnnotations.map(a => a.prUrl).filter(Boolean));
    const multiPR = prUrls.size > 1;

    const grouped = new Map<string, CodeAnnotation[]>();
    for (const ann of visibleAnnotations) {
      const existing = grouped.get(ann.filePath) || [];
      existing.push(ann);
      grouped.set(ann.filePath, existing);
    }
    for (const [, anns] of grouped) {
      anns.sort(compareCodeAnnotations);
    }

    let prs: Map<string, Map<string, CodeAnnotation[]>> | null = null;
    if (multiPR) {
      prs = new Map();
      for (const ann of visibleAnnotations) {
        const prKey = ann.prUrl ?? '_none';
        if (!prs.has(prKey)) prs.set(prKey, new Map());
        const fileMap = prs.get(prKey)!;
        const existing = fileMap.get(ann.filePath) || [];
        existing.push(ann);
        fileMap.set(ann.filePath, existing);
      }
      for (const fileMap of prs.values()) {
        for (const anns of fileMap.values()) {
          anns.sort(compareCodeAnnotations);
        }
      }
    }

    return { groupedAnnotations: grouped, prGroups: prs, isMultiPR: multiPR };
  }, [visibleAnnotations]);

  if (!isOpen) return null;

  function renderAnnotationCard(annotation: CodeAnnotation) {
    const isSelected = selectedAnnotationId === annotation.id;
    const isFileScope = getAnnotationScope(annotation) === 'file';
    return (
      <div
        key={annotation.id}
        onClick={() => onSelectAnnotation(annotation.id)}
        className={`group relative p-2.5 rounded border cursor-pointer transition-colors duration-150 ${
          isSelected
            ? 'bg-primary/5 border-primary/30'
            : 'border-transparent hover:bg-muted/30'
        }`}
      >
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            {isFileScope ? (
              <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                file
              </span>
            ) : (
              <span className="text-[10px] font-mono text-muted-foreground">
                {annotation.lineStart === annotation.lineEnd
                  ? `L${annotation.lineStart}`
                  : `L${annotation.lineStart}-${annotation.lineEnd}`}
                {annotation.tokenText && (
                  <span className="ml-1 text-primary/70">{`\`${annotation.tokenText.length > 30 ? annotation.tokenText.slice(0, 27) + '...' : annotation.tokenText}\``}</span>
                )}
              </span>
            )}
            {annotation.conventionalLabel && (
              <ConventionalLabelBadge label={annotation.conventionalLabel} decorations={annotation.decorations} />
            )}
            {annotation.author && (
              <span className={`text-[10px] truncate max-w-[100px] ${isCurrentUser(annotation.author) ? 'text-muted-foreground/50' : 'text-muted-foreground/70'}`}>
                {annotation.author}{isCurrentUser(annotation.author) && ' (me)'}
              </span>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground/50">
            {formatRelativeTime(annotation.createdAt)}
          </span>
        </div>
        {annotation.text && (
          <div className="text-xs text-foreground/80 line-clamp-2 review-comment-markdown">
            {renderInlineMarkdown(annotation.text)}
          </div>
        )}
        {annotation.suggestedCode && (
          <div className="mt-1.5">
            <SuggestionPreview code={annotation.suggestedCode} originalCode={annotation.originalCode} language={detectLanguage(annotation.filePath)} />
          </div>
        )}
        <div className="flex items-center justify-end gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {analysisMode && annotation.text && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAskComment?.(annotation);
              }}
              className="px-1.5 py-0.5 rounded text-[10px] text-muted-foreground hover:text-accent hover:bg-accent/10 transition-colors"
              title="Ask about this comment"
            >
              Ask
            </button>
          )}
          {annotation.text && (
            <CopyButton text={`${annotation.filePath}:${annotation.lineStart}${annotation.lineEnd !== annotation.lineStart ? `-${annotation.lineEnd}` : ''}\n${annotation.text}${annotation.reasoning ? `\n\nReasoning: ${annotation.reasoning}` : ''}`} variant="inline" />
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeleteAnnotation(annotation.id);
            }}
            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
            title="Delete annotation"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <aside className="border-l border-border/50 bg-card/30 backdrop-blur-sm flex flex-col flex-shrink-0" style={{ width: width ?? 288 }}>
        {/* Header */}
        <div className="px-3 flex items-center border-b border-border/50" style={{ height: 'var(--panel-header-h)' }}>
          <div className="flex items-center gap-2 w-full min-w-0">
            <button
              onClick={onClose}
              className="flex items-center justify-center w-5 h-5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
              title="Close sidebar"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground truncate">
              {analysisMode
                ? activeTab === 'annotations' ? 'Info' : activeTab === 'ai' ? 'Chat' : 'Agents'
                : activeTab === 'annotations' ? 'Annotations' : activeTab === 'ai' ? 'AI' : 'Review Agents'}
            </h2>
            {activeTab === 'annotations' && totalCount > 0 && (
              <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                {totalCount}
              </span>
            )}
            {activeTab === 'agents' && (agentJobs?.length ?? 0) > 0 && (
              <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                {agentJobs!.length}
              </span>
            )}
            {activeTab === 'ai' && aiMessages.length > 0 && (
              <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                {aiMessages.length}
              </span>
            )}
          </div>
        </div>

        {/* Content */}
        <OverlayScrollArea className="flex-1 min-h-0">
          {/* Annotations tab */}
          {activeTab === 'annotations' && (
            <div className="p-2 space-y-1.5">
              {analysisMode && (
                <AnalysisInfoPanel
                  analysis={analysis ?? null}
                  prMetadata={prMetadata}
                  onRunAnalysis={onRunAnalysis}
                  onRunReview={onRunReview}
                  onUpdateFindingStatus={onUpdateFindingStatus}
                  onAskFinding={onAskFinding}
                  onPostFinding={onPostFinding}
                />
              )}

              {!analysisMode && totalCount === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-center px-4">
                  <div className="w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center mb-3">
                    <svg className="w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                    </svg>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Click on lines to add annotations
                  </p>
                </div>
              ) : visibleAnnotations.length > 0 ? (
                <div className="p-2 space-y-4">
                  {isMultiPR && prGroups ? (
                    Array.from(prGroups.entries()).map(([prUrl, fileMap]) => {
                      const sample = fileMap.values().next().value?.[0];
                      const prLabel = prUrl === '_none' ? 'Local Changes' :
                        `${sample?.prRepo ? `${sample.prRepo}` : ''}#${sample?.prNumber ?? '?'} ${sample?.prTitle ?? ''}`;
                      return (
                        <div key={prUrl}>
                          <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm px-2 py-1.5 text-[10px] font-medium text-accent/80 border-b border-border/30 mb-1">
                            {prLabel}
                          </div>
                          <div className="space-y-4">
                            {Array.from(fileMap.entries()).map(([filePath, fileAnnotations]) => (
                              <div key={filePath}>
                                <div className="sticky top-7 z-10 bg-background/95 backdrop-blur-sm px-2 py-1 text-xs font-mono text-muted-foreground truncate">
                                  {filePath.split('/').pop()}
                                </div>
                                <div className="space-y-1">
                                  {fileAnnotations.map((annotation) => renderAnnotationCard(annotation))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    Array.from(groupedAnnotations.entries()).map(([filePath, fileAnnotations]) => (
                      <div key={filePath}>
                        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm px-2 py-1 text-xs font-mono text-muted-foreground truncate">
                          {filePath.split('/').pop()}
                        </div>
                        <div className="space-y-1">
                          {fileAnnotations.map((annotation) => renderAnnotationCard(annotation))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : analysisMode && (
                <div className="px-3 py-4 text-xs text-muted-foreground/60 text-center">
                  No human comments yet.
                </div>
              )}

              {/* Editor annotations (VS Code) */}
              {editorAnnotations && editorAnnotations.length > 0 && (
                <>
                  {annotations.length > 0 && (
                    <div className="flex items-center gap-2 pt-2 pb-1">
                      <div className="flex-1 border-t border-border/30" />
                      <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60">Editor</span>
                      <div className="flex-1 border-t border-border/30" />
                    </div>
                  )}
                  {editorAnnotations.map(ann => (
                    <EditorAnnotationCard
                      key={ann.id}
                      annotation={ann}
                      onDelete={() => onDeleteEditorAnnotation?.(ann.id)}
                    />
                  ))}
                </>
              )}

            </div>
          )}

          {/* AI tab */}
          {activeTab === 'ai' && (
            <AITab
              messages={aiMessages}
              isCreatingSession={isAICreatingSession}
              isStreaming={isAIStreaming}
              activeFilePath={activeFilePath}
              scrollToQuestionId={scrollToQuestionId}
              onScrollToLines={onScrollToAILines ?? (() => {})}
              onAskGeneral={onAskGeneral}
              permissionRequests={aiPermissionRequests}
              onRespondToPermission={onRespondToPermission}
              aiProviders={aiProviders}
              aiConfig={aiConfig}
              onAIConfigChange={onAIConfigChange}
              hasAISession={hasAISession}
            />
          )}

          {/* Agents tab */}
          {activeTab === 'agents' && (
            <AgentsTab
              jobs={agentJobs ?? []}
              capabilities={agentCapabilities ?? null}
              onLaunch={onAgentLaunch ?? (() => {})}
              onKillJob={onAgentKillJob ?? (() => {})}
              onKillAll={onAgentKillAll ?? (() => {})}
              externalAnnotations={externalAnnotations ?? []}
              onOpenJobDetail={onOpenJobDetail}
            />
          )}

        </OverlayScrollArea>

        {/* Quick Copy Footer — annotations tab only */}
        {activeTab === 'annotations' && feedbackMarkdown && totalCount > 0 && (
          <div className="p-2 border-t border-border/50">
            <button
              onClick={handleQuickCopy}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded text-xs font-medium transition-all text-muted-foreground hover:text-foreground hover:bg-muted/50"
            >
              {copied ? (
                <>
                  <svg className="w-3.5 h-3.5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Copied
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy Feedback
                </>
              )}
            </button>
          </div>
        )}
    </aside>
  );
};
