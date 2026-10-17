-- Durable video processing needs both polling recovery and abandoned-upload
-- cleanup. The secrets are provisioned in Vault during environment setup so no
-- service-role key is committed to the repository.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'project_url')
    OR NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'service_role_key') THEN
    RAISE EXCEPTION 'Vault secrets project_url and service_role_key are required before scheduling video jobs';
  END IF;

  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname IN ('reconcile-video-transcriptions-every-minute', 'reap-video-uploads-every-15-minutes');

  PERFORM cron.schedule(
    'reconcile-video-transcriptions-every-minute',
    '* * * * *',
    $job$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
          || '/functions/v1/reconcile-video-transcriptions',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
        ),
        body := '{}'::jsonb
      );
    $job$
  );

  PERFORM cron.schedule(
    'reap-video-uploads-every-15-minutes',
    '*/15 * * * *',
    $job$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
          || '/functions/v1/video-upload-session',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
        ),
        body := '{"action":"reap"}'::jsonb
      );
    $job$
  );
END
$$;
