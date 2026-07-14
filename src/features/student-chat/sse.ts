// Client-side parsing for the SSE protocol rag-chat streams (see
// supabase/functions/_shared's formatSseEvent for the server-side encoder).
export interface ParsedSseEvent {
  event: string;
  data: string;
}

export function parseSseEventBlock(block: string): ParsedSseEvent | null {
  const normalized = block.replace(/\r/g, '');
  const lines = normalized.split('\n');
  const dataLines: string[] = [];
  let event = 'message';

  for (const line of lines) {
    if (!line || line.startsWith(':')) {
      continue;
    }

    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      continue;
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    event,
    data: dataLines.join('\n'),
  };
}

export function parseMaybeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
