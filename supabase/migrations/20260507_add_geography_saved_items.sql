-- Migration: Extend Saved Items to Geography
-- Description: Adds 'commune', 'department', and 'region' to the allowed item types in user_saved_items.

-- We need to drop and recreate the constraint because item_type is a text column with a check constraint.
ALTER TABLE public.user_saved_items DROP CONSTRAINT IF EXISTS user_saved_items_item_type_check;

ALTER TABLE public.user_saved_items ADD CONSTRAINT user_saved_items_item_type_check 
  CHECK (item_type IN ('scrutin', 'law', 'commune', 'department', 'region'));

-- Add a column for label/name to avoid redundant API calls if possible (optional but helpful for performance)
-- For now, we stick to IDs to keep it clean, as frontend can fetch metadata.
