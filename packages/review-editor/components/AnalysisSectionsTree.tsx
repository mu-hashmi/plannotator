import React, { useEffect, useMemo, useState } from 'react';
import type { ReviewAnalysisSection } from '@plannotator/shared/review-analysis';
import { OverlayScrollArea } from '@plannotator/ui/components/OverlayScrollArea';

interface AnalysisSectionsTreeProps {
  sections: ReviewAnalysisSection[];
  width?: number;
  activeMode: 'files' | 'sections';
  onModeChange: (mode: 'files' | 'sections') => void;
  onSelectAnchor: (anchor: ReviewAnalysisSection['anchors'][number]) => void;
  onAskSection?: (section: ReviewAnalysisSection) => void;
  onRunAnalysis?: () => void;
  isRunning?: boolean;
}

export const AnalysisSectionsTree: React.FC<AnalysisSectionsTreeProps> = ({
  sections,
  width,
  activeMode,
  onModeChange,
  onSelectAnchor,
  onAskSection,
  onRunAnalysis,
  isRunning = false,
}) => {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(sections.map(section => section.id)));
  const totals = useMemo(
    () => sections.reduce((sum, section) => ({
      additions: sum.additions + section.additions,
      deletions: sum.deletions + section.deletions,
    }), { additions: 0, deletions: 0 }),
    [sections],
  );

  useEffect(() => {
    setExpanded(prev => new Set([...prev, ...sections.map(section => section.id)]));
  }, [sections]);

  return (
    <aside className="border-r border-border/50 bg-card/30 flex flex-col flex-shrink-0 overflow-hidden" style={{ width: width ?? 256 }}>
      <div className="px-3 flex items-center border-b border-border/50" style={{ height: 'var(--panel-header-h)' }}>
        <NavModeToggle activeMode={activeMode} onModeChange={onModeChange} sectionsCount={sections.length} />
      </div>

      <OverlayScrollArea className="flex-1 min-h-0">
        {sections.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4 py-8">
            <div className="w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center mb-3">
              <svg className="w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h18M5 7v10a2 2 0 002 2h10a2 2 0 002-2V7M8 11h8M8 15h5" />
              </svg>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              No analysis sections yet.
            </p>
            {onRunAnalysis && (
              <button
                onClick={onRunAnalysis}
                disabled={isRunning}
                className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground disabled:opacity-50"
              >
                {isRunning ? 'Running analysis...' : 'Run analysis'}
              </button>
            )}
          </div>
        ) : (
          <div className="px-1 py-1">
            {sections.map((section) => {
              const isExpanded = expanded.has(section.id);
              return (
                <div key={section.id} className="mb-1">
                  <button
                    onClick={() => {
                      setExpanded(prev => {
                        const next = new Set(prev);
                        if (next.has(section.id)) next.delete(section.id);
                        else next.add(section.id);
                        return next;
                      });
                    }}
                    className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-muted transition-colors group"
                  >
                    <div className="flex items-center gap-1.5">
                      <svg className={`w-3 h-3 text-muted-foreground/50 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                      <span className="font-medium text-foreground truncate">{section.title}</span>
                      <span className="ml-auto text-[10px] tabular-nums opacity-60">
                        <span className="text-green-500">+{section.additions}</span>{' '}
                        <span className="text-red-500">-{section.deletions}</span>
                      </span>
                    </div>
                    <div className="pl-[18px] mt-1 flex flex-wrap gap-1">
                      {section.files.slice(0, 3).map(file => (
                        <span key={file} className="max-w-[120px] truncate text-[10px] text-muted-foreground/70 bg-muted/50 rounded px-1.5 py-0.5">
                          {file.split('/').pop()}
                        </span>
                      ))}
                      {section.files.length > 3 && (
                        <span className="text-[10px] text-muted-foreground/60 px-1.5 py-0.5">+{section.files.length - 3}</span>
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="ml-3 border-l border-border/30 pl-2 py-1 space-y-1">
                      <div className="px-2 py-1.5 rounded bg-muted/20">
                        <p className="text-xs text-muted-foreground line-clamp-4 whitespace-pre-line">{section.explanation}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          {onAskSection && (
                            <button
                              onClick={() => onAskSection(section)}
                              className="text-[10px] font-medium text-accent hover:text-accent/80"
                            >
                              Ask about this
                            </button>
                          )}
                        </div>
                      </div>
                      {section.anchors.map((anchor, index) => (
                        <button
                          key={`${anchor.filePath}:${anchor.lineStart}:${index}`}
                          onClick={() => onSelectAnchor(anchor)}
                          className="w-full flex items-center gap-1.5 px-2 py-1 rounded-sm text-xs font-mono text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        >
                          <span className="truncate">{anchor.label || anchor.filePath.split('/').pop()}</span>
                          <span className="ml-auto text-[10px]">
                            L{anchor.lineStart}{anchor.lineEnd !== anchor.lineStart ? `-${anchor.lineEnd}` : ''}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </OverlayScrollArea>

      <div className="px-2 py-1.5 border-t border-border/50 text-xs text-muted-foreground">
        <div className="flex items-center justify-between">
          <span>{sections.length} section{sections.length !== 1 ? 's' : ''}</span>
          <span className="file-stats inline-flex items-center gap-1.5">
            <span className="additions">+{totals.additions}</span>
            <span className="deletions">-{totals.deletions}</span>
          </span>
        </div>
      </div>
    </aside>
  );
};

export const NavModeToggle: React.FC<{
  activeMode: 'files' | 'sections';
  onModeChange: (mode: 'files' | 'sections') => void;
  sectionsCount?: number;
}> = ({ activeMode, onModeChange, sectionsCount = 0 }) => (
  <div className="w-full flex items-center gap-1 bg-muted rounded-md p-0.5">
    <button
      onClick={() => onModeChange('files')}
      className={`flex-1 px-2 py-1 rounded text-[10px] font-semibold uppercase tracking-wider transition-colors ${
        activeMode === 'files' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      Files
    </button>
    <button
      onClick={() => onModeChange('sections')}
      className={`flex-1 px-2 py-1 rounded text-[10px] font-semibold uppercase tracking-wider transition-colors ${
        activeMode === 'sections' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      Sections{sectionsCount > 0 ? ` ${sectionsCount}` : ''}
    </button>
  </div>
);
