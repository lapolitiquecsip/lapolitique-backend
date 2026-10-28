-- Votes de l'Assemblée (scrutins.group_results) : les noms des groupes de la XVIIe législature
-- étaient décalés par le collecteur (PO845401, le RN, étiqueté « LFI-NFP », etc.) sur ~2 800
-- scrutins, et absents sur ~6 300. On réécrit l'étiquette d'après le code d'organe (vérifié par
-- les effectifs : RN 121, EPR 90, LFI 70, SOC 68, DR 47, EcoS 38, Dem 37, HOR 35, LIOT 23, GDR 17, UDR 17).
with noms(po, nom) as (values
  ('PO845401', 'RN'), ('PO845407', 'EPR (Ensemble)'), ('PO845413', 'LFI-NFP'), ('PO845419', 'Socialistes'),
  ('PO845425', 'Droite Républicaine'), ('PO845439', 'Écologistes'), ('PO845454', 'MoDem'), ('PO845470', 'Horizons'),
  ('PO845485', 'LIOT'), ('PO845514', 'GDR'), ('PO872880', 'UDR (Ciotti)'), ('PO847173', 'UDR (Ciotti)'), ('PO840056', 'Non-inscrits')
)
update public.scrutins s
   set group_results = (
     select jsonb_agg(case when n.nom is not null then e.g || jsonb_build_object('group_label', n.nom) else e.g end order by e.ord)
       from jsonb_array_elements(s.group_results) with ordinality as e(g, ord)
       left join noms n on n.po = e.g->>'group_id'
   )
 where jsonb_typeof(s.group_results) = 'array'
   and exists (select 1 from jsonb_array_elements(s.group_results) g join noms n on n.po = g->>'group_id'
               where coalesce(g->>'group_label', '') <> n.nom);
