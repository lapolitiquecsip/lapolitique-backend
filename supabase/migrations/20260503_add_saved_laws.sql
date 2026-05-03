-- Migration: Add Saved Laws for Premium Users
CREATE TABLE IF NOT EXISTS public.user_saved_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  item_id TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('scrutin', 'law')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, item_id, item_type)
);

-- Enable RLS
ALTER TABLE public.user_saved_items ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can manage their own saved items" ON public.user_saved_items
  FOR ALL USING (auth.uid() = user_id);

-- Admin access
CREATE POLICY "Admin full access for saved items" ON public.user_saved_items
  FOR ALL USING (public.is_admin());
