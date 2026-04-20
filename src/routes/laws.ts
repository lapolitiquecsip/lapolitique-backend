import { Router } from 'express';
import { supabase } from '../config/supabase.js';

const router = Router();

// GET all laws
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('laws')
      .select('id, title, summary, vote_result, category, created_at, date_adopted')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    console.error('Error fetching laws:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET a specific law
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('laws')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    console.error('Error fetching law:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
