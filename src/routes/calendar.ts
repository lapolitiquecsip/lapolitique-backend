import { Router } from 'express';
import { supabase } from '../config/supabase.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('events').select('*').order('date');
    if (error) throw error;
    // Map db columns to frontend expectations if needed, but doing raw is fine
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
