import { Router } from 'express';
import { supabase } from '../config/supabase.js';

const router = Router();

// POST a new subscriber
router.post('/', async (req, res) => {
  try {
    const { email, preferences, zip_code } = req.body;

    if (!email) {
      return res.status(400).json({ error: "L'e-mail est requis." });
    }

    // Insert into Supabase
    const { data, error } = await supabase
      .from('subscribers')
      .insert([
        { 
          email, 
          preferences: preferences || {},
          postal_code: zip_code || null,
          status: 'active'
        }
      ])
      .select()
      .single();

    if (error) {
      // Handle unique constraint error if duplicate email
      if (error.code === '23505') {
        return res.status(409).json({ error: "Cet e-mail est déjà abonné." });
      }
      throw error;
    }

    console.log(`[EMAIL MOCK] Email de bienvenue envoyé à : ${email}`);
    
    // Si l'utilisateur voulait suivre un député et a fourni un zip_code, 
    // l'API pourrait ici chercher le(s) député(s) liés au code postal.
    if (zip_code) {
      console.log(`[ZIP CODE] L'abonné a indiqué le code postal : ${zip_code}`);
    }

    res.status(201).json({ 
      message: "Abonnement réussi !", 
      subscriber: data 
    });
  } catch (error: any) {
    console.error('Error creating subscriber:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET all subscribers (for admin dashboard counting)
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('subscribers')
      .select('id, email, status, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    console.error('Error fetching subscribers:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
