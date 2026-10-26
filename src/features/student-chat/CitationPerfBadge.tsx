import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

import {
  downloadCitationPerf,
  isCitationPerfEnabled,
  lastCitationPerfSample,
  type CitationPerfSample,
} from './citationPerf';

const UPDATE_EVENT = 'citation-perf:updated';

export function CitationPerfBadge() {
  const enabled = isCitationPerfEnabled();
  const [sample, setSample] = useState<CitationPerfSample | null>(() => lastCitationPerfSample());

  useEffect(() => {
    if (!enabled) return;
    const update = () => setSample(lastCitationPerfSample());
    window.addEventListener(UPDATE_EVENT, update);
    return () => window.removeEventListener(UPDATE_EVENT, update);
  }, [enabled]);

  if (!enabled || !sample) return null;

  const transcript = sample.durations.openToTranscriptMs;
  const panel = sample.durations.openToPanelMs;
  return (
    <div className="flex items-center gap-1 rounded-md border border-border bg-background/80 px-2 py-1 text-[11px] text-muted-foreground">
      <span className="font-medium text-foreground">
        {transcript === null ? 'n/a' : `${transcript}ms`}
      </span>
      <span className="hidden sm:inline">transcript</span>
      <span aria-hidden="true">·</span>
      <span>{panel === null ? 'n/a' : `${panel}ms`}</span>
      <span className="hidden sm:inline">panel</span>
      <span aria-hidden="true">·</span>
      <span>{sample.mediaRequests3s} media</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        aria-label="Download citation perf JSON"
        onClick={downloadCitationPerf}
      >
        <Download className="h-3 w-3" />
      </Button>
    </div>
  );
}
