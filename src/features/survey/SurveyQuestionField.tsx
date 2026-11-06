import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import { matrixAnswerKey, type SurveyQuestion } from './surveyQuestions';

interface SurveyQuestionFieldProps {
  question: SurveyQuestion;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}

interface PillGroupProps {
  groupLabel: string;
  options: readonly string[];
  selected: string;
  onSelect: (value: string) => void;
}

function PillGroup({ groupLabel, options, selected, onSelect }: PillGroupProps) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={groupLabel}>
      {options.map((option) => {
        const isSelected = selected === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={`${groupLabel} — ${option}`}
            onClick={() => onSelect(option)}
            className={cn(
              'rounded-md border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isSelected
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background text-foreground hover:bg-accent',
            )}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

function MultiChoiceGroup({
  groupLabel,
  options,
  exclusiveOptions = [],
  selected,
  onSelect,
}: Omit<PillGroupProps, 'selected' | 'onSelect'> & {
  exclusiveOptions?: readonly string[];
  selected: readonly string[];
  onSelect: (value: string[]) => void;
}) {
  const toggle = (option: string) => {
    if (exclusiveOptions.includes(option)) {
      onSelect(selected.includes(option) ? [] : [option]);
      return;
    }

    const next = selected.includes(option)
      ? selected.filter((selectedOption) => selectedOption !== option)
      : [...selected.filter((selectedOption) => !exclusiveOptions.includes(selectedOption)), option];
    onSelect(next);
  };

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={groupLabel}>
      {options.map((option) => {
        const isSelected = selected.includes(option);
        return (
          <button
            key={option}
            type="button"
            role="checkbox"
            aria-checked={isSelected}
            aria-label={`${groupLabel} — ${option}`}
            onClick={() => toggle(option)}
            className={cn(
              'rounded-md border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isSelected
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background text-foreground hover:bg-accent',
            )}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

function ScaleInput({
  groupLabel,
  question,
  selected,
  onSelect,
}: {
  groupLabel: string;
  question: SurveyQuestion;
  selected: string;
  onSelect: (value: string) => void;
}) {
  const min = question.min ?? 1;
  const max = question.max ?? 5;
  const options = Array.from({ length: max - min + 1 }, (_, index) => String(min + index));

  return (
    <div className="space-y-2">
      <PillGroup
        groupLabel={groupLabel}
        options={options}
        selected={selected}
        onSelect={onSelect}
      />
      {(question.minLabel || question.maxLabel) && (
        <div className="flex justify-between gap-4 text-xs text-muted-foreground">
          <span>{question.minLabel}</span>
          <span>{question.maxLabel}</span>
        </div>
      )}
    </div>
  );
}

export function SurveyQuestionField({ question, values, onChange }: SurveyQuestionFieldProps) {
  const label = question.showNumber === false ? question.prompt : `${question.number}. ${question.prompt}`;
  const toggle = (key: string, value: string) => {
    onChange(key, values[key] === value ? '' : value);
  };

  if (question.kind === 'open') {
    return (
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground">{label}</legend>
        <Textarea
          aria-label={label}
          value={values[question.id] ?? ''}
          onChange={(event) => onChange(question.id, event.target.value)}
          placeholder={question.placeholder ?? 'Type your answer (optional).'}
          rows={question.rows ?? 3}
          maxLength={5000}
        />
      </fieldset>
    );
  }

  if (question.kind === 'matrix') {
    return (
      <fieldset className="space-y-4">
        <legend className="text-sm font-medium text-foreground">{label}</legend>
        {(question.features ?? []).map((feature) => {
          const key = matrixAnswerKey(question.id, feature);
          const groupLabel = `${label} — ${feature}`;
          return (
            <div key={feature} className="space-y-2">
              <p className="text-sm text-muted-foreground">{feature}</p>
              <ScaleInput
                groupLabel={groupLabel}
                question={question}
                selected={values[key] ?? ''}
                onSelect={(value) => toggle(key, value)}
              />
            </div>
          );
        })}
      </fieldset>
    );
  }

  if (question.kind === 'multiChoice') {
    const selected = values[question.id]?.split('\n').filter(Boolean) ?? [];
    const hasOther = question.otherOption && selected.includes(question.otherOption);

    return (
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-foreground">{label}</legend>
        <MultiChoiceGroup
          groupLabel={label}
          options={question.options ?? []}
          exclusiveOptions={question.exclusiveOptions}
          selected={selected}
          onSelect={(next) => onChange(question.id, next.join('\n'))}
        />
        {hasOther && (
          <Textarea
            aria-label={`${label} — ${question.otherOption}`}
            value={values[`${question.id}:other`] ?? ''}
            onChange={(event) => onChange(`${question.id}:other`, event.target.value)}
            placeholder="Please specify"
            rows={2}
            maxLength={5000}
          />
        )}
      </fieldset>
    );
  }

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-foreground">{label}</legend>
      {question.kind === 'scale' ? (
        <ScaleInput
          groupLabel={label}
          question={question}
          selected={values[question.id] ?? ''}
          onSelect={(value) => toggle(question.id, value)}
        />
      ) : (
        <PillGroup
          groupLabel={label}
          options={question.options ?? []}
          selected={values[question.id] ?? ''}
          onSelect={(value) => toggle(question.id, value)}
        />
      )}
    </fieldset>
  );
}
