import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const getValidSupabaseUrl = (): string => {
  const url = process.env.SUPABASE_URL;
  if (!url || url.trim() === '' || url === 'undefined' || url === 'null' || !url.trim().toLowerCase().startsWith('http')) {
    return 'https://placeholder.supabase.co';
  }
  return url.trim();
};

const getValidSupabaseKey = (): string => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!key || key.trim() === '' || key === 'undefined' || key === 'null') {
    return 'placeholder_key';
  }
  return key.trim();
};

const supabaseUrl = getValidSupabaseUrl();
const supabaseKey = getValidSupabaseKey();

export const supabase = createClient(supabaseUrl, supabaseKey);
