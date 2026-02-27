DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'punch_type' AND e.enumlabel = 'BREAK_START'
  ) THEN
    ALTER TYPE punch_type ADD VALUE 'BREAK_START';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'punch_type' AND e.enumlabel = 'BREAK_END'
  ) THEN
    ALTER TYPE punch_type ADD VALUE 'BREAK_END';
  END IF;
END $$;

ALTER TABLE punches ADD COLUMN IF NOT EXISTS is_auto boolean;
