# Authentication Flow

Supabase Auth (email/password), client-side session in `localStorage`, roles enforced via RLS + edge-function checks.

## How it works

1. **Client** — `src/integrations/supabase/client.ts` creates the Supabase client (`persistSession: true`, `autoRefreshToken: true`, `localStorage`).
2. **Session state** — `src/contexts/AuthContext.tsx` (`AuthProvider`/`useAuth`) subscribes to `onAuthStateChange` + `getSession()`, fetches the matching `profiles` row, exposes `user`, `session`, `profile`, `isAdmin`, `isStudent`, `signOut()`.
3. **Sign in/up** — `src/pages/Auth.tsx`: `supabase.auth.signInWithPassword` / `supabase.auth.signUp`. Signup sends an email confirmation link (`emailRedirectTo`), not an OTP.
   - **Password reset (OTP code, not a link)** — "Forgot password?" on the sign-in tab (or `/auth?mode=forgot`) calls `supabase.auth.resetPasswordForEmail(email)` and hands the email to `src/pages/ResetPassword.tsx` via router state. That page (a public route) asks for the 6-digit code from the email and calls `supabase.auth.verifyOtp({ email, token, type: 'recovery' })`; the resulting session flips the page to a new-password form backed by `supabase.auth.updateUser({ password })`. **Why a code:** university mail (Microsoft 365 Safe Links, Gmail) pre-fetches links in incoming email, which consumes Supabase's single-use recovery link before the user clicks it (`otp_expired`). **Ops note:** the "Reset Password" email template in the Supabase dashboard must render `{{ .Token }}` and must **not** include `{{ .ConfirmationURL }}` / `{{ .TokenHash }}` — the link and the code are the same one-time token, so a scanned link burns the code. The built-in mailer is capped at 2 emails/hour project-wide; configure custom SMTP before relying on this in production.
4. **Profile creation** — DB trigger `handle_new_user()` (`supabase/migrations/20260205125807_*.sql`) inserts a `profiles` row on `auth.users` insert, role hardcoded to default `student` — can't be self-elevated via signup metadata. Good.
5. **Route protection** — `src/components/auth/ProtectedRoute.tsx` gates on `user` + optional `requiredRole` (`student`/`admin`), redirects to `/auth` or the user's own dashboard.
6. **Roles** — originally `student`/`lecturer`, `admin` added later, `lecturer` fully retired in `20260303160000_remove_lecturer_role.sql`. Now just `student`/`admin`.
7. **Edge functions** — all have `verify_jwt = false` in `supabase/config.toml` (gateway doesn't block unauthenticated calls), so each function must check auth itself. Privileged ones (`manage-course-invites`, `generate-course-code`) do call `is_admin` RPC server-side — fine.

## Problems found

1. **OTP verification screen is dead code.** [Auth.tsx](src/pages/Auth.tsx) has a full OTP UI (`showOtpInput`, `handleVerifyOtp`, `supabase.auth.verifyOtp`) but `setShowOtpInput(true)` is never called anywhere — signup only ever shows the "check your email" message and uses link-based confirmation (`emailRedirectTo`). The OTP path is unreachable, ~80 lines of unused UI/logic. Either wire it up or delete it.

2. ~~**No password-reset flow.**~~ Resolved — see "How it works" §3. Forgot-password + `/reset-password` (OTP code flow) shipped (`Auth.tsx`, `ResetPassword.tsx`).

3. **`reap-stale-jobs` has no authentication at all.** [supabase/functions/reap-stale-jobs/index.ts](supabase/functions/reap-stale-jobs/index.ts) takes no Authorization header, runs with the service-role key, and is publicly invokable (verify_jwt=false + no in-function check). Anyone with the URL can trigger DB writes and fan out worker invocations repeatedly — a resource-exhaustion vector. Add a shared-secret header or restrict to a scheduled/internal trigger.

4. **`check-course-invite` leaks account existence.** Given an email, it returns `accountExists` and `alreadyEnrolled` with no auth or rate limiting — a minor account-enumeration vector. Likely acceptable for the invite UX but worth rate-limiting.

5. **CORS wildcard (`Access-Control-Allow-Origin: *`) on every edge function**, including ones that accept bearer tokens (`redeem-course-invite`, `manage-course-invites`, etc). Not exploitable on its own since the token itself is the credential, but combined with #3 it widens the attack surface for anyone probing function URLs directly.

## Not a problem (verified, noted for completeness)

- Profile `role` can't be set at signup — trigger hardcodes `student`; admin escalation only happens via direct DB/RLS-gated function calls.
- `manage-course-invites` / `generate-course-code` both verify `is_admin` server-side despite `verify_jwt=false`.
