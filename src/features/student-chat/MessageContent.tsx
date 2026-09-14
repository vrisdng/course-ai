import type { Message } from './types';
import { RichMarkdown } from './RichMarkdown';

interface MessageContentProps {
  message: Message;
  onCitationClick: (message: Message, citationNumber: number) => void;
}

export function MessageContent({ message, onCitationClick }: MessageContentProps) {
  return (
    <RichMarkdown
      content={message.content}
      citations={message.citations}
      onCitationClick={(citationNumber) => onCitationClick(message, citationNumber)}
    />
  );
}
