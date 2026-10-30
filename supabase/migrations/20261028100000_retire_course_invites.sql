-- Release the frontend without invite callers and delete the four retired Edge
-- Functions before applying this migration. Existing enrollments remain intact.
-- DROP TABLE removes this table's own staff/password-setup policies and indexes.
-- RESTRICT (the default) refuses unexpected external dependencies; do not CASCADE.
DROP TABLE IF EXISTS public.course_invites;
