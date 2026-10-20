import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import type { Course } from '@/features/materials/types';
import {
  ALL_MODEL_TIERS,
  CHAT_SETTING_FIELD_GROUPS,
  CHAT_SETTING_RANGES,
  DEFAULT_CHAT_SETTINGS,
  MODEL_TIER_LABELS,
  fromDisplayValue,
  sliderRange,
  snapToStep,
  toDisplayValue,
  validateChatSettings,
  type ChatModelTier,
  type ChatSettings,
  type NumericFieldSpec,
} from './chatSettingsForm';
import { useCourseChatSettings } from './useCourseChatSettings';

interface CourseChatSettingsPanelProps {
  courses: Course[];
  isLoadingCourses: boolean;
  userId: string | undefined;
}

export function CourseChatSettingsPanel({ courses, isLoadingCourses, userId }: CourseChatSettingsPanelProps) {
  const [courseId, setCourseId] = useState<string | null>(null);
  const activeCourseId = courseId ?? courses[0]?.id ?? null;
  const { settings, isLoading, isSaving, loadError, save } = useCourseChatSettings(activeCourseId, userId);
  const [draft, setDraft] = useState<ChatSettings | null>(null);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const errors = useMemo(() => (draft ? validateChatSettings(draft) : {}), [draft]);
  const isDirty = Boolean(draft && settings && JSON.stringify(draft) !== JSON.stringify(settings));
  const canSave = isDirty && Object.keys(errors).length === 0 && !isSaving;

  const update = (patch: Partial<ChatSettings>) => setDraft((current) => (current ? { ...current, ...patch } : current));

  const toggleTier = (tier: ChatModelTier, checked: boolean) => {
    if (!draft) return;
    const allowed = new Set(draft.allowedModelTiers);
    if (checked) allowed.add(tier);
    else allowed.delete(tier);
    update({ allowedModelTiers: ALL_MODEL_TIERS.filter((candidate) => allowed.has(candidate)) });
  };

  if (!isLoadingCourses && courses.length === 0) {
    return <p className="text-sm text-muted-foreground">Create a course first to configure its chat.</p>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Chat settings</CardTitle>
        <CardDescription>
          Tune how the course chat retrieves material and answers. Changes apply to the next question asked in the course.
        </CardDescription>
        <div className="max-w-sm pt-2">
          <Label htmlFor="chat-settings-course">Course</Label>
          <Select value={activeCourseId ?? ''} onValueChange={setCourseId} disabled={isLoadingCourses || isSaving}>
            <SelectTrigger id="chat-settings-course" className="mt-1">
              <SelectValue placeholder={isLoadingCourses ? 'Loading courses...' : 'Select a course'} />
            </SelectTrigger>
            <SelectContent>
              {courses.map((course) => (
                <SelectItem key={course.id} value={course.id}>
                  {course.code ? `${course.code} · ${course.name}` : course.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="space-y-8">
        {loadError ? (
          <p role="alert" className="text-sm text-destructive">Could not load chat settings: {loadError}</p>
        ) : null}
        {isLoading || (!draft && !loadError) ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading settings...
          </div>
        ) : null}

        {draft ? (
          <>
            {CHAT_SETTING_FIELD_GROUPS.map((group) => (
              <section key={group.title} className="space-y-4">
                <h3 className="text-base font-semibold text-foreground">{group.title}</h3>
                <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
                  {group.fields.map((field) => (
                    <NumericField
                      key={field.key}
                      field={field}
                      value={draft[field.key]}
                      error={errors[field.key]}
                      onChange={(value) => update({ [field.key]: value })}
                    />
                  ))}
                  {group.title === 'Retrieval' ? (
                    <div className="flex items-start gap-3 md:col-span-2">
                      <Checkbox
                        id="chat-settings-query-rewrite"
                        checked={draft.queryRewriteEnabled}
                        onCheckedChange={(checked) => update({ queryRewriteEnabled: checked === true })}
                      />
                      <div className="space-y-1">
                        <Label htmlFor="chat-settings-query-rewrite">Rewrite follow-up questions before searching</Label>
                        <p className="text-xs text-muted-foreground">
                          Turns "what about the second one?" into a standalone search. Costs one extra model call per follow-up.
                        </p>
                      </div>
                    </div>
                  ) : null}
                  {group.title === 'Answer' ? (
                    <ModelTierFields
                      allowed={draft.allowedModelTiers}
                      defaultTier={draft.defaultModelTier}
                      allowedError={errors.allowedModelTiers}
                      defaultError={errors.defaultModelTier}
                      onToggle={toggleTier}
                      onDefaultChange={(tier) => update({ defaultModelTier: tier })}
                    />
                  ) : null}
                </div>
              </section>
            ))}

            <section className="space-y-2">
              <Label htmlFor="chat-settings-instructions" className="text-base font-semibold">Course instructions</Label>
              <p className="text-xs text-muted-foreground">
                Added to every chat in this course, before each student's own preferences. For example: tone, notation, or topics to stay within.
              </p>
              <Textarea
                id="chat-settings-instructions"
                value={draft.courseInstructions}
                onChange={(event) => update({ courseInstructions: event.target.value })}
                rows={5}
                maxLength={CHAT_SETTING_RANGES.courseInstructionsMaxChars}
              />
              <p className="text-xs text-muted-foreground">
                {draft.courseInstructions.length}/{CHAT_SETTING_RANGES.courseInstructionsMaxChars}
              </p>
              {errors.courseInstructions ? <p className="text-xs text-destructive">{errors.courseInstructions}</p> : null}
            </section>

            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <Button onClick={() => draft && void save(draft)} disabled={!canSave}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save changes
              </Button>
              <Button variant="outline" onClick={() => setDraft(settings)} disabled={!isDirty || isSaving}>
                Discard changes
              </Button>
              <Button
                variant="ghost"
                onClick={() => setDraft({ ...DEFAULT_CHAT_SETTINGS, allowedModelTiers: [...DEFAULT_CHAT_SETTINGS.allowedModelTiers] })}
                disabled={isSaving}
              >
                Reset to defaults
              </Button>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

interface NumericFieldProps {
  field: NumericFieldSpec;
  value: number;
  error: string | undefined;
  onChange: (value: number) => void;
}

// A slider for quick adjustment, with a number box beside it for an exact
// value. Both edit the same setting; the box also shows invalid input.
function NumericField({ field, value, error, onChange }: NumericFieldProps) {
  const id = `chat-settings-${field.key}`;
  const labelId = `${id}-label`;
  const range = sliderRange(field);
  const unit = field.unit ? ` ${field.unit}` : '';
  const displayValue = Number.isFinite(value) ? toDisplayValue(field, value) : null;
  // An empty or out-of-range box leaves the thumb at the nearest end.
  const sliderValue = Math.min(range.max, Math.max(range.min, displayValue ?? range.min));

  return (
    <div className="space-y-2">
      <Label id={labelId} htmlFor={id}>{field.label}</Label>
      <div className="flex items-center gap-3">
        <Slider
          min={range.min}
          max={range.max}
          step={range.step}
          value={[sliderValue]}
          onValueChange={([next]) => onChange(fromDisplayValue(field, snapToStep(field, next)))}
          aria-labelledby={labelId}
          className="flex-1"
        />
        <div className="flex shrink-0 items-center gap-1">
          <Input
            id={id}
            type="number"
            inputMode="decimal"
            step={field.step}
            min={range.min}
            max={range.max}
            value={displayValue ?? ''}
            onChange={(event) => {
              const raw = event.target.value;
              onChange(raw === '' ? Number.NaN : fromDisplayValue(field, Number(raw)));
            }}
            aria-invalid={Boolean(error)}
            className="h-8 w-24 text-right"
          />
          {field.unit ? <span className="text-xs text-muted-foreground">{field.unit}</span> : null}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {field.description} Default {toDisplayValue(field, DEFAULT_CHAT_SETTINGS[field.key])}{unit}.
      </p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

interface ModelTierFieldsProps {
  allowed: ChatModelTier[];
  defaultTier: ChatModelTier;
  allowedError: string | undefined;
  defaultError: string | undefined;
  onToggle: (tier: ChatModelTier, checked: boolean) => void;
  onDefaultChange: (tier: ChatModelTier) => void;
}

function ModelTierFields({ allowed, defaultTier, allowedError, defaultError, onToggle, onDefaultChange }: ModelTierFieldsProps) {
  return (
    <>
      <div className="space-y-2">
        <p className="text-sm font-medium leading-none">Models students can pick</p>
        <div className="flex flex-wrap gap-4 pt-1">
          {ALL_MODEL_TIERS.map((tier) => (
            <div key={tier} className="flex items-center gap-2">
              <Checkbox
                id={`chat-settings-tier-${tier}`}
                checked={allowed.includes(tier)}
                onCheckedChange={(checked) => onToggle(tier, checked === true)}
              />
              <Label htmlFor={`chat-settings-tier-${tier}`}>{MODEL_TIER_LABELS[tier]}</Label>
            </div>
          ))}
        </div>
        {allowedError ? <p className="text-xs text-destructive">{allowedError}</p> : null}
      </div>
      <div className="space-y-1">
        <Label htmlFor="chat-settings-default-tier">Default model</Label>
        <Select value={defaultTier} onValueChange={(value) => onDefaultChange(value as ChatModelTier)}>
          <SelectTrigger id="chat-settings-default-tier">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ALL_MODEL_TIERS.map((tier) => (
              <SelectItem key={tier} value={tier}>{MODEL_TIER_LABELS[tier]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">What students start on. A request for a model that isn't allowed runs on this one.</p>
        {defaultError ? <p className="text-xs text-destructive">{defaultError}</p> : null}
      </div>
    </>
  );
}
