import { getCitationKey } from './citations';
import { RichMarkdown } from './RichMarkdown';
import type { Citation, Message } from './types';

interface MessageContentProps {
  message: Message;
  onCitationClick: (message: Message, citationNumber: number) => void;
  onCitationOpen?: (citation: Citation, citationKey: string) => void;
}

export function MessageContent({ message, onCitationClick, onCitationOpen }: MessageContentProps) {
  return (
    <RichMarkdown
      content={message.content}
      citations={message.citations}
      onCitationClick={(citationNumber) => onCitationClick(message, citationNumber)}
      onCitationOpen={onCitationOpen
        ? (citation, citationNumber) => onCitationOpen(citation, getCitationKey(message.id, citationNumber))
        : undefined}
    />
  );
}
