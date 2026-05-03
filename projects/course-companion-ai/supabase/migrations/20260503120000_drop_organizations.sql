-- Drop the organizations table, its FK columns on dependent tables, and any
-- remaining RLS policies referencing it. The org boundary is no longer used;
-- access control is handled per-user / per-course instead.

-- Drop any remaining org-boundary RLS policies (idempotent).
drop policy if exists "org boundary - conversations" on public.conversations;
drop policy if exists "org boundary - courses" on public.courses;
drop policy if exists "org boundary - materials" on public.materials;
drop policy if exists "org boundary - enrollments" on public.enrollments;
drop policy if exists "org boundary - student_documents" on public.student_documents;
drop policy if exists "org boundary - course_invites" on public.course_invites;
drop policy if exists "org boundary - query_events" on public.query_events;

-- Drop FK columns on dependent tables. Using IF EXISTS so this is safe to
-- re-run and tolerant of columns that may have been removed manually.
alter table public.courses             drop column if exists org_id;
alter table public.materials           drop column if exists org_id;
alter table public.enrollments         drop column if exists org_id;
alter table public.conversations       drop column if exists org_id;
alter table public.student_documents   drop column if exists org_id;
alter table public.course_invites      drop column if exists org_id;
alter table public.query_events        drop column if exists org_id;

-- Finally drop the table itself. CASCADE handles any leftover dependents
-- (views, triggers, FKs we may have missed).
drop table if exists public.organizations cascade;
