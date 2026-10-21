import { useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { parseStudentEmails } from './parseStudentEmails';

interface ImportResult { email: string; status: string; error?: string }
interface ImportStudentsDialogProps { courseId: string; onImported: () => void }
const STATUS_LABELS: Record<string, string> = {
  created: 'Created and enrolled', enrolled: 'Existing student enrolled', already_enrolled: 'Already enrolled',
  skipped_non_student: 'Skipped: non-student account', failed: 'Failed',
};

export function ImportStudentsDialog({ courseId, onImported }: ImportStudentsDialogProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [error, setError] = useState('');
  const parsed = parseStudentEmails(text);

  const importStudents = async () => {
    setBusy(true); setError(''); setResults([]);
    let imported = false;
    try {
      for (let offset = 0; offset < parsed.emails.length; offset += 20) {
        const { data, error: requestError } = await supabase.functions.invoke('import-course-students', {
          body: { courseId, emails: parsed.emails.slice(offset, offset + 20) },
        });
        if (requestError || data?.error || !Array.isArray(data?.results)) {
          throw new Error(data?.error || requestError?.message || 'Unexpected import response');
        }
        const batch = data.results as ImportResult[];
        imported ||= batch.some((result) => result.status === 'created' || result.status === 'enrolled');
        setResults((previous) => [...previous, ...batch]);
      }
    } catch (failure) {
      setError(`${failure instanceof Error ? failure.message : 'Import failed'}. You can safely retry; existing accounts keep their passwords.`);
    } finally {
      setBusy(false);
      if (imported) onImported();
    }
  };

  return <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
    <DialogTrigger asChild><Button className="gap-2"><Upload className="h-4 w-4" />Import students</Button></DialogTrigger>
    <DialogContent aria-describedby={undefined} className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>Import students</DialogTitle>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="student-csv">CSV or text file</Label>
        <Input id="student-csv" type="file" accept=".csv,.txt,text/csv,text/plain" disabled={busy}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            try { setText(await file.text()); setResults([]); setError(''); }
            catch { setError('Could not read this file. Try pasting the emails below.'); }
          }} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="student-emails">Student emails</Label>
        <Textarea id="student-emails" rows={6} disabled={busy} value={text}
          placeholder={'ada@university.edu, grace@university.edu\nstudent@university.edu'}
          onChange={(event) => { setText(event.target.value); setResults([]); setError(''); }} />
        <p className="text-sm text-muted-foreground">Emails only, separated by commas or new lines. An email header is optional. {parsed.emails.length} unique emails.</p>
      </div>
      {parsed.invalid.length > 0 && <p role="alert" className="text-sm text-destructive">Fix invalid entries: {parsed.invalid.join(', ')}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button disabled={busy || !parsed.emails.length || parsed.invalid.length > 0} onClick={() => void importStudents()}>
        {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Importing… {results.length}/{parsed.emails.length}</> : `Import ${parsed.emails.length} student${parsed.emails.length === 1 ? '' : 's'}`}
      </Button>
      {results.length > 0 && <ul aria-live="polite" className="space-y-2 text-sm">
        {results.map((result) => <li key={result.email} className="break-all"><span className="font-medium">{result.email}</span>: <span>{STATUS_LABELS[result.status] || result.status}</span>
          {result.error && <p className="text-destructive">{result.error}</p>}</li>)}
      </ul>}
    </DialogContent>
  </Dialog>;
}
