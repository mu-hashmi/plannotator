import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ReviewAnalysis,
  ReviewAnalysisEvent,
  ReviewFindingStatus,
} from '@plannotator/shared/review-analysis';

const BASE_URL = '/api/review-analysis';
const STREAM_URL = `${BASE_URL}/stream`;
const RUN_URL = `${BASE_URL}/run`;
const POLL_INTERVAL_MS = 500;

interface UseReviewAnalysisReturn {
  analysis: ReviewAnalysis | null;
  version: number;
  runAnalysis: () => Promise<void>;
  runReview: () => Promise<void>;
  runAll: () => Promise<void>;
  updateFindingStatus: (id: string, status: ReviewFindingStatus) => Promise<void>;
}

export function useReviewAnalysis(options?: { enabled?: boolean }): UseReviewAnalysisReturn {
  const enabled = options?.enabled ?? true;
  const [analysis, setAnalysis] = useState<ReviewAnalysis | null>(null);
  const [version, setVersion] = useState(0);
  const versionRef = useRef(0);
  const fallbackRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const receivedSnapshotRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    receivedSnapshotRef.current = false;
    fallbackRef.current = false;

    const applySnapshot = (next: ReviewAnalysis, nextVersion: number) => {
      setAnalysis(next);
      setVersion(nextVersion);
      versionRef.current = nextVersion;
    };

    const es = new EventSource(STREAM_URL);
    es.onmessage = (event) => {
      if (cancelled) return;
      try {
        const parsed = JSON.parse(event.data) as ReviewAnalysisEvent;
        if ('analysis' in parsed) {
          receivedSnapshotRef.current = true;
          applySnapshot(parsed.analysis, parsed.version);
        }
      } catch {
        // Heartbeats and malformed events are ignored.
      }
    };

    es.onerror = () => {
      if (!receivedSnapshotRef.current && !fallbackRef.current) {
        fallbackRef.current = true;
        es.close();
        startPolling();
      }
    };

    async function fetchSnapshot() {
      try {
        const url = versionRef.current > 0 ? `${BASE_URL}?since=${versionRef.current}` : BASE_URL;
        const res = await fetch(url);
        if (res.status === 304 || !res.ok) return;
        const data = await res.json() as { analysis?: ReviewAnalysis; version?: number };
        if (data.analysis && typeof data.version === 'number') {
          applySnapshot(data.analysis, data.version);
        }
      } catch {
        // Next poll retries.
      }
    }

    function startPolling() {
      if (cancelled) return;
      fetchSnapshot();
      pollTimerRef.current = setInterval(() => {
        if (!cancelled) fetchSnapshot();
      }, POLL_INTERVAL_MS);
    }

    return () => {
      cancelled = true;
      es.close();
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [enabled]);

  const run = useCallback(async (kind: 'analysis' | 'review' | 'all') => {
    await fetch(RUN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind }),
    });
  }, []);

  const updateFindingStatus = useCallback(async (id: string, status: ReviewFindingStatus) => {
    setAnalysis(prev => prev ? {
      ...prev,
      findings: prev.findings.map(finding => finding.id === id ? { ...finding, status } : finding),
    } : prev);
    const res = await fetch(`${BASE_URL}?id=${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Failed to update finding' }));
      throw new Error(data.error ?? 'Failed to update finding');
    }
  }, []);

  return {
    analysis,
    version,
    runAnalysis: () => run('analysis'),
    runReview: () => run('review'),
    runAll: () => run('all'),
    updateFindingStatus,
  };
}
