import { supabase } from '../config/supabase.js';

export async function runSeed() {
  console.log('[Seed] Starting database seeding...');

  try {
    // 1. Vocabulary
    const vocabularyList = [
      { term: "Motion de censure", definition: "Vote par lequel les députés peuvent renverser le gouvernement. Si plus de 289 députés votent pour, le Premier ministre doit remettre sa démission.", example: "L'opposition a déposé une motion de censure après l'utilisation du 49-3 par le gouvernement.", category: "Procédure", difficulty: 2 },
      { term: "Article 49-3", definition: "Article de la Constitution qui permet au gouvernement d'adopter un texte de loi sans vote des députés. Le gouvernement engage sa responsabilité. L'opposition peut alors déposer une motion de censure dans les 24h.", example: "Le gouvernement a eu recours au 49-3 pour faire passer le budget sans vote.", category: "Constitution", difficulty: 3 },
      { term: "Dissolution", definition: "Décision du Président de la République de mettre fin au mandat de l'Assemblée nationale avant son terme. De nouvelles élections législatives sont alors organisées dans les 20 à 40 jours.", category: "Constitution", difficulty: 2 },
      { term: "Navette parlementaire", definition: "Allers-retours d'un texte de loi entre l'Assemblée nationale et le Sénat jusqu'à ce qu'ils se mettent d'accord sur une version identique.", category: "Procédure", difficulty: 2 },
      { term: "Ordonnance", definition: "Texte pris par le gouvernement dans un domaine qui relève normalement de la loi. Le Parlement doit d'abord autoriser le gouvernement à légiférer par ordonnance.", category: "Constitution", difficulty: 3 },
      { term: "Référendum", definition: "Vote par lequel les citoyens sont directement consultés pour approuver ou rejeter un texte de loi ou une décision politique.", category: "Élections", difficulty: 1 },
      { term: "Commission mixte paritaire", definition: "Réunion de 7 députés et 7 sénateurs chargés de trouver un texte de compromis quand l'Assemblée et le Sénat ne sont pas d'accord.", category: "Procédure", difficulty: 3 },
      { term: "Question de confiance", definition: "Procédure par laquelle le Premier ministre demande à l'Assemblée nationale de confirmer son soutien au gouvernement via l'article 49-1.", category: "Procédure", difficulty: 2 },
      { term: "Amendement", definition: "Modification proposée à un texte de loi en cours d'examen. N'importe quel député, sénateur ou le gouvernement peut en déposer.", category: "Procédure", difficulty: 1 },
      { term: "Promulgation", definition: "Acte par lequel le Président de la République signe officiellement une loi votée par le Parlement, la rendant applicable.", category: "Procédure", difficulty: 2 }
    ];

    // Clear existing to avoid duplicates in this simple seed
    const { error: vocDeleteError } = await supabase.from('vocabulary').delete().neq('term', 'impossible_string');
    if (vocDeleteError) throw new Error(`Vocab delete error: ${vocDeleteError.message}`);
    const { error: vocInsertError } = await supabase.from('vocabulary').insert(vocabularyList);
    if (vocInsertError) throw new Error(`Vocab insert error: ${vocInsertError.message}`);
    console.log(`[Seed] Inserted ${vocabularyList.length} vocabulary terms.`);

    // 2. Deputies
    const deputiesList = [
      { first_name: "Mathilde", last_name: "Panot", party: "LFI-NFP", party_color: "#E74C3C", department: "Val-de-Marne", constituency_number: 10 },
      { first_name: "Gabriel", last_name: "Attal", party: "EPR", party_color: "#E67E22", department: "Hauts-de-Seine", constituency_number: 10 },
      { first_name: "Marine", last_name: "Le Pen", party: "RN", party_color: "#2C3E50", department: "Pas-de-Calais", constituency_number: 11 },
      { first_name: "Aurore", last_name: "Bergé", party: "EPR", party_color: "#E67E22", department: "Yvelines", constituency_number: 7 },
      { first_name: "François", last_name: "Ruffin", party: "Picardie Debout", party_color: "#95A5A6", department: "Somme", constituency_number: 1 },
      { first_name: "Sandrine", last_name: "Rousseau", party: "EELV", party_color: "#27AE60", department: "Paris", constituency_number: 9 },
      { first_name: "Olivier", last_name: "Faure", party: "PS", party_color: "#E91E8C", department: "Seine-et-Marne", constituency_number: 11 },
      { first_name: "Laurent", last_name: "Wauquiez", party: "LR", party_color: "#3498DB", department: "Haute-Loire", constituency_number: 1 },
      { first_name: "Sébastien", last_name: "Chenu", party: "RN", party_color: "#2C3E50", department: "Nord", constituency_number: 19 },
      { first_name: "Yaël", last_name: "Braun-Pivet", party: "EPR", party_color: "#E67E22", department: "Yvelines", constituency_number: 5 },
      { first_name: "Cyrielle", last_name: "Chatelain", party: "EELV", party_color: "#27AE60", department: "Isère", constituency_number: 1 },
      { first_name: "Éric", last_name: "Ciotti", party: "UDR", party_color: "#95A5A6", department: "Alpes-Maritimes", constituency_number: 1 }
    ];

    const { error: depDeleteError } = await supabase.from('deputies').delete().neq('last_name', 'impossible_string');
    if (depDeleteError) throw new Error(`Deputies delete error: ${depDeleteError.message}`);
    const { error: depInsertError } = await supabase.from('deputies').insert(deputiesList);
    if (depInsertError) throw new Error(`Deputies insert error: ${depInsertError.message}`);
    console.log(`[Seed] Inserted ${deputiesList.length} deputies.`);

    // 3. Content
    const now = new Date();
    const contentsText = [
      { titre_original: "Projet de loi de finances", titre_simplifie: "Le vote du budget de l'État", resume_flash: "L'assemblée a entamé l'examen du PLF pour l'année prochaine.", resume_detaille: "Un long débat s'est ouvert sur les recettes fiscales prévues par le PLF. Le gouvernement insiste sur le maintien du déficit sous la barre des 5%, tandis que plusieurs oppositions proposent des amendements pour augmenter les dépenses sociales...", institution: "assemblée", status: "published" },
      { titre_original: "Audition commission affaires sociales", titre_simplifie: "Audition sur l'hôpital public", resume_flash: "La commission des affaires sociales a entendu la ministre de la Santé.", resume_detaille: "Pendant environ deux heures, les parlementaires ont auditionné la ministre sur le manque de lits dans les hôpitaux. Plusieurs pistes ont été évoquées, dont le recrutement de personnel et la revalorisation salariale...", institution: "sénat", status: "published" },
      { titre_original: "Décret 2024-XXX sur la transition", titre_simplifie: "Nouveau décret écologique", resume_flash: "Le gouvernement a publié un décret accélérant la transition environnementale.", resume_detaille: "Ce décret, acté ce matin au Conseil des ministres, impose de nouvelles normes pour les rénovations thermiques obligatoires d'ici 5 ans...", institution: "gouvernement", status: "published" },
      { titre_original: "Projet de loi Climat 2", titre_simplifie: "Une suite à la loi Climat", resume_flash: "L'assemblée nationale s'empare du nouveau texte visant à réduire l'empreinte carbone.", resume_detaille: "Ce texte prévoit notamment de nouvelles mesures sur le transport de marchandises et une aide élargie pour la rénovation des bâtiments...", institution: "assemblée", status: "published" },
      { titre_original: "Communication sur la sécurité", titre_simplifie: "Annonces sur la sécurité", resume_flash: "Le ministre de l'Intérieur a dévoilé son plan d'action.", resume_detaille: "La communication a porté sur le renforcement des effectifs de police dans une trentaine de grandes villes françaises...", institution: "gouvernement", status: "published" },
      { titre_original: "PPL Sécurité globale", titre_simplifie: "Examen de la loi Sécurité", resume_flash: "Le Sénat examine à son tour la loi sur la Sécurité.", resume_detaille: "Le Sénat souhaite amender le texte de l'Assemblée afin de revoir certains points touchant aux prérogatives de la police municipale et au respect de la vie privée...", institution: "sénat", status: "published" },
      { titre_original: "Loi Numérique", titre_simplifie: "Souveraineté numérique", resume_flash: "Les députés votent sur la loi de régulation des géants du web.", resume_detaille: "Le texte vise à imposer de nouvelles règles locales aux plateformes numériques majeures et propose la création d'un fonds de soutien aux entreprises technologiques...", institution: "assemblée", status: "published" },
      { titre_original: "Résolution européenne environnement", titre_simplifie: "Résolution sur l'environnement", resume_flash: "L'Assemblée a adopté une résolution européenne...", resume_detaille: "Ce texte, plutôt sans valeur contraignante, signale la position de la France vis-à-vis des futures normes agricoles européennes...", institution: "assemblée", status: "published" }
    ];

    const mappedContent = contentsText.map((c, i) => {
      // distribute dates over the last week
      const d = new Date(now.getTime() - i * 86400000);
      return { ...c, date_publication: d.toISOString(), date_traitement: now.toISOString() };
    });

    const { error: contentDeleteError } = await supabase.from('content').delete().neq('titre_original', 'impossible_string');
    if (contentDeleteError) throw new Error(`Content delete error: ${contentDeleteError.message}`);
    const { error: contentInsertError } = await supabase.from('content').insert(mappedContent);
    if (contentInsertError) throw new Error(`Content insert error: ${contentInsertError.message}`);
    console.log(`[Seed] Inserted ${contentsText.length} content items.`);
    // 4. Politicians
    const politiciansList = [
      { id: '11111111-1111-1111-1111-111111111111', first_name: 'Emmanuel', last_name: 'Macron', role: 'Président', party: 'EPR', party_color: '#E67E22', active: true },
      { id: '22222222-2222-2222-2222-222222222222', first_name: 'Marine', last_name: 'Le Pen', role: 'Députée', party: 'RN', party_color: '#2C3E50', active: true },
      { id: '33333333-3333-3333-3333-333333333333', first_name: 'Jean-Luc', last_name: 'Mélenchon', role: 'Chef de file', party: 'LFI', party_color: '#E74C3C', active: true },
    ];
    const { error: polDeleteError } = await supabase.from('politicians').delete().neq('last_name', 'impossible_string');
    if (polDeleteError) throw new Error(`Politicians delete error: ${polDeleteError.message}`);
    const { error: polInsertError } = await supabase.from('politicians').insert(politiciansList);
    if (polInsertError) throw new Error(`Politicians insert error: ${polInsertError.message}`);
    console.log(`[Seed] Inserted 3 politicians.`);

    // 5. Promises
    const promisesList = [
      { politician_id: '11111111-1111-1111-1111-111111111111', citation: 'Nous atteindrons le plein emploi avant 2027.', date_made: '2022-04-10', source_url: 'https://example.com', status: 'in-progress' },
      { politician_id: '11111111-1111-1111-1111-111111111111', citation: 'Aucune augmentation des impôts sur les classes moyennes.', date_made: '2022-05-15', source_url: 'https://example.com', status: 'kept' },
      { politician_id: '11111111-1111-1111-1111-111111111111', citation: 'Fin des véhicules thermiques en 2035.', date_made: '2023-01-20', source_url: 'https://example.com', status: 'in-progress' },
      { politician_id: '11111111-1111-1111-1111-111111111111', citation: 'Un médecin traitant pour chaque Français.', date_made: '2022-08-30', source_url: 'https://example.com', status: 'broken' },
      { politician_id: '22222222-2222-2222-2222-222222222222', citation: 'Je supprimerai la TVA sur un panier de 100 produits de première nécessité.', date_made: '2022-03-12', source_url: 'https://example.com', status: 'pending' },
      { politician_id: '22222222-2222-2222-2222-222222222222', citation: 'Baisse de la TVA de 20% à 5,5% sur le carburant.', date_made: '2022-04-05', source_url: 'https://example.com', status: 'pending' },
      { politician_id: '33333333-3333-3333-3333-333333333333', citation: 'Le SMIC sera augmenté à 1600 euros net dès le premier mois.', date_made: '2024-05-10', source_url: 'https://example.com', status: 'pending' },
      { politician_id: '33333333-3333-3333-3333-333333333333', citation: 'Retraite à 60 ans pour tout le monde avec 40 annuités.', date_made: '2024-06-01', source_url: 'https://example.com', status: 'pending' },
    ];
    const { error: promDeleteError } = await supabase.from('promises').delete().neq('citation', 'impossible_string');
    if (promDeleteError) throw new Error(`Promises delete error: ${promDeleteError.message}`);
    const { error: promInsertError } = await supabase.from('promises').insert(promisesList);
    if (promInsertError) throw new Error(`Promises insert error: ${promInsertError.message}`);
    console.log(`[Seed] Inserted 8 promises.`);
    // 6. Laws
    const lawsList = [
      {
        title: "Projet de loi relatif à l'accompagnement des malades et de la fin de vie",
        summary: "Ce texte vise à renforcer les soins palliatifs et à instaurer une 'aide à mourir' sous conditions strictes.",
        context: "La convention citoyenne sur la fin de vie s'est prononcée majoritairement en faveur d'une évolution de la loi Claeys-Leonetti.",
        impact: JSON.stringify({
          pros: ["Respect de la liberté de choix en fin de vie", "Meilleur encadrement des situations extrêmes de souffrance"],
          cons: ["Dérives potentielles et pression sur les personnes vulnérables", "Crainte d'un désinvestissement dans les soins palliatifs classiques"]
        }),
        vote_result: "En cours",
        category: "Société",
        timeline: JSON.stringify([
          { date: "2024-04-10", title: "Présentation au Conseil des ministres", status: "success" },
          { date: "2024-05-27", title: "Début de l'examen à l'Assemblée Nationale", status: "success" },
          { date: "2024-06-11", title: "Vote à l'Assemblée Nationale", status: "success" },
          { date: "2024-11-15", title: "Examen au Sénat", status: "pending" }
        ])
      },
      {
        title: "Loi pour le plein emploi",
        summary: "Réforme visant à atteindre le plein emploi via la transformation de Pôle emploi en 'France Travail'.",
        context: "L'objectif est de réduire le taux de chômage à 5% d'ici 2027.",
        impact: JSON.stringify({
          pros: ["Meilleur accompagnement et guichet unique", "Mise en activité renforcée pour les bénéficiaires du RSA"],
          cons: ["Logique de sanction envers les plus précaires", "Moyens alloués jugés insuffisants par les syndicats"]
        }),
        vote_result: "Adoptée",
        category: "Économie",
        timeline: JSON.stringify([
          { date: "2023-06-07", title: "Présentation en Conseil des ministres", status: "success" },
          { date: "2023-07-11", title: "Vote au Sénat (1ère lecture)", status: "success" },
          { date: "2023-10-10", title: "Vote à l'Assemblée Nationale", status: "success" },
          { date: "2023-11-20", title: "Adoption définitive avec CMP", status: "success" },
          { date: "2023-12-18", title: "Promulgation", status: "success" }
        ]),
        date_adopted: "2023-12-18"
      }
    ];

    const { error: lawDeleteError } = await supabase.from('laws').delete().neq('title', 'impossible_string');
    if (lawDeleteError) throw new Error(`Laws delete error: ${lawDeleteError.message}`);
    const { error: lawInsertError } = await supabase.from('laws').insert(lawsList);
    if (lawInsertError) throw new Error(`Laws insert error: ${lawInsertError.message}`);
    console.log(`[Seed] Inserted 2 laws.`);

    return { message: "Seed completed successfully" };
  } catch (error) {
    console.error("[Seed] Error during seeding:", error);
    throw error;
  }
}
