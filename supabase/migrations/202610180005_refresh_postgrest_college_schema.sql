-- Refresh PostgREST after the college RPCs are installed or repaired.
-- This also covers projects where the directory migration was already applied
-- before its functions appeared in the API schema cache.
notify pgrst, 'reload schema';
