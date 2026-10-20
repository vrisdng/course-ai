import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const nameSchema = z.object({
  fullName: z.string().trim().min(1, 'Enter your name').max(200, 'Name must be 200 characters or fewer'),
});
type NameFormData = z.infer<typeof nameSchema>;
interface StudentNameSetupProps { successMessage: string | null; onComplete: () => void }

export function StudentNameSetup({ successMessage, onComplete }: StudentNameSetupProps) {
  const { user, refreshProfile, signOut } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<NameFormData>({ resolver: zodResolver(nameSchema), defaultValues: { fullName: '' } });

  const handleSaveName = async ({ fullName }: NameFormData) => {
    if (!user) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const { error: saveError } = await supabase.from('profiles').update({ full_name: fullName })
        .eq('user_id', user.id).select('user_id').single();
      if (saveError) {
        setError(saveError.message);
        return;
      }
      await refreshProfile();
      onComplete();
    } catch {
      setError('Your name could not be saved. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return <form onSubmit={form.handleSubmit(handleSaveName)}>
    <CardHeader>
      <CardTitle>What should we call you?</CardTitle>
      <CardDescription>Enter your name to finish setting up your account. Your lecturers will see this name.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      {error && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>{error}</AlertDescription></Alert>}
      {successMessage && <Alert className="border-success/50 bg-success/10"><CheckCircle2 className="h-4 w-4 text-success" /><AlertDescription>{successMessage}</AlertDescription></Alert>}
      <div className="space-y-2">
        <Label htmlFor="setup-full-name">Full name</Label>
        <Input id="setup-full-name" autoComplete="name" maxLength={200} disabled={isSubmitting || Boolean(successMessage)} {...form.register('fullName')} />
        {form.formState.errors.fullName && <p className="text-sm text-destructive">{form.formState.errors.fullName.message}</p>}
      </div>
    </CardContent>
    <CardFooter className="flex flex-col gap-2">
      <Button type="submit" className="w-full" disabled={isSubmitting || Boolean(successMessage)}>
        {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</> : 'Save name'}
      </Button>
      <Button type="button" variant="ghost" disabled={isSubmitting} onClick={() => void signOut()}>Sign out</Button>
    </CardFooter>
  </form>;
}
