import { ReactNode, useEffect, useRef, type ClipboardEvent } from 'react';
import { Bot, ChevronDown, ImagePlus, Send, Square, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { ACCEPTED_IMAGE_TYPES, MAX_QUESTION_IMAGES, type PendingImage } from './questionImages';
import { CHAT_MODEL_OPTIONS, type ChatModelTier } from './useStudentChat';

interface ChatComposerProps {
  input: string;
  isLoading: boolean;
  disabled?: boolean;
  onInputChange: (nextValue: string) => void;
  onSend: () => void;
  onStop: () => void;
  placeholder?: string;
  footerText?: string;
  documentSelector?: ReactNode;
  documentHint?: string | null;
  selectedModel?: ChatModelTier;
  onModelChange?: (model: ChatModelTier) => void;
  // Tiers the course allows; every tier when omitted.
  modelOptions?: ChatModelTier[];
  // Images to send with the question; attaching is offered only when
  // onAddImages is set.
  images?: PendingImage[];
  onAddImages?: (files: File[]) => void;
  onRemoveImage?: (id: string) => void;
}

export function ChatComposer({
  input,
  isLoading,
  disabled = false,
  onInputChange,
  onSend,
  onStop,
  placeholder = 'Ask a question about your course materials...',
  footerText = 'CEEGPT uses RAG to ground answers in your course materials',
  documentSelector,
  documentHint,
  selectedModel,
  onModelChange,
  modelOptions,
  images = [],
  onAddImages,
  onRemoveImage,
}: ChatComposerProps) {
  const selectedModelOption = CHAT_MODEL_OPTIONS.find((modelOption) => modelOption.value === selectedModel);
  const selectedModelLabel = selectedModelOption?.label ?? 'GPT-5.6 Luna';
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canSend = Boolean(input.trim()) || images.length > 0;

  useEffect(() => {
    if (!textareaRef.current) return;

    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
  }, [input]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };

  // Screenshots pasted into the box become attachments; text pastes as usual.
  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!onAddImages) return;
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) return;
    if (!event.clipboardData.getData('text/plain')) event.preventDefault();
    onAddImages(files);
  };

  return (
    <div className="border-t border-border bg-background p-4">
      <div className="mx-auto max-w-5xl space-y-3">
        {(documentSelector || documentHint) ? (
          <div className="flex flex-wrap items-center gap-2">
            {documentSelector}
            {documentHint ? (
              <span className="text-xs text-muted-foreground">{documentHint}</span>
            ) : null}
          </div>
        ) : null}

        {images.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label="Attached images">
            {images.map((image) => (
              <li key={image.id} className="relative">
                <img
                  src={image.previewUrl}
                  alt={image.file.name}
                  className="h-16 w-16 rounded-md border border-border object-cover"
                />
                <button
                  type="button"
                  onClick={() => onRemoveImage?.(image.id)}
                  aria-label={`Remove ${image.file.name}`}
                  disabled={isLoading}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:text-foreground disabled:opacity-50"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="relative" data-tour="composer">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={placeholder}
            className="min-h-[80px] max-h-[200px] resize-none pb-8 pr-14"
            rows={1}
            disabled={isLoading || disabled}
          />
          <div className="absolute bottom-2 left-2 flex items-center gap-1">
          {onAddImages ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_IMAGE_TYPES.join(',')}
                multiple
                hidden
                aria-label="Image files"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = '';
                  if (files.length > 0) onAddImages(files);
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                aria-label="Attach images"
                title="Attach images (or paste a screenshot)"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading || disabled || images.length >= MAX_QUESTION_IMAGES}
              >
                <ImagePlus className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : null}
          {onModelChange ? (
            <div data-tour="model-picker">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                    disabled={isLoading || disabled}
                  >
                    <Bot className="h-3 w-3" />
                    {selectedModelLabel}
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" className="w-56">
                  {CHAT_MODEL_OPTIONS.filter((option) => !modelOptions || modelOptions.includes(option.value)).map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      onSelect={() => onModelChange(option.value)}
                      className={cn(
                        'items-start gap-2 py-2',
                        selectedModel === option.value && 'font-medium'
                      )}
                    >
                      <Bot className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="space-y-0.5">
                        <div>{option.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {option.description}
                        </div>
                      </div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
          </div>
          <div className="absolute bottom-2 right-2">
            <Button
              onClick={isLoading ? onStop : onSend}
              aria-label={isLoading ? undefined : 'Send'}
              disabled={(!isLoading && !canSend) || disabled}
              size={isLoading ? 'default' : 'icon'}
              variant={isLoading ? 'outline' : 'default'}
              className={cn(
                'h-8 shrink-0',
                isLoading ? 'gap-2 px-3 text-xs' : 'w-8'
              )}
            >
              {isLoading ? (
                <>
                  <Square className="h-3 w-3 fill-current" />
                  <span>Stop</span>
                </>
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          {footerText}
        </p>
      </div>
    </div>
  );
}
