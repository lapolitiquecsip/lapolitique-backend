import { Router } from 'express';
import { supabase } from '../config/supabase.js';

const router = Router();

// GET all politicians with their total and kept promises count
router.get('/', async (req, res) => {
  try {
    const { data: politicians, error: polError } = await supabase
      .from('politicians')
      .select('*')
      .order('last_name', { ascending: true });

    if (polError) throw polError;

    // Fetch all promises to aggregate counts manually (easier than complex RPC right now)
    const { data: promises, error: promError } = await supabase
      .from('promises')
      .select('politician_id, status');

    if (promError) throw promError;

    const aggregated = politicians.map((pol) => {
      const polPromises = promises?.filter(p => p.politician_id === pol.id) || [];
      const total = polPromises.length;
      const kept = polPromises.filter(p => p.status === 'kept').length;
      const broken = polPromises.filter(p => p.status === 'broken').length;
      const inProgress = polPromises.filter(p => p.status === 'in-progress').length;
      const pending = polPromises.filter(p => p.status === 'pending').length;

      return {
        ...pol,
        promises: {
          total,
          kept,
          broken,
          inProgress,
          pending
        }
      };
    });

    res.json(aggregated);
  } catch (error: any) {
    console.error('Error fetching politicians:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET single politician
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('politicians')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    console.error('Error fetching politician:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET politician promises
router.get('/:id/promises', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.query; // optional filter

    let query = supabase
      .from('promises')
      .select('*')
      .eq('politician_id', id)
      .order('date_made', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw error;
    
    res.json(data);
  } catch (error: any) {
    console.error('Error fetching promises:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
