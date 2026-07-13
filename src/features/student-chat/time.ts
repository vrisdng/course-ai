export function formatTimestamp(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatCitationLocator(input: {
  pageNumber?: number;
  startMs?: number;
  endMs?: number;
}) {
  if (typeof input.startMs === 'number') {
    const start = formatTimestamp(input.startMs);
    return typeof input.endMs === 'number' ? `${start}-${formatTimestamp(input.endMs)}` : start;
  }

  if (typeof input.pageNumber === 'number') {
    return `Page ${input.pageNumber}`;
  }

  return 'Location not available';
}
