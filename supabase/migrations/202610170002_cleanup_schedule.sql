-- Run after the main migration. Supabase's Cron extension is required.
create extension if not exists pg_cron;
select cron.schedule('strangertalk-retention','* * * * *','select private.st_cleanup()');
