import "dotenv/config";
import fs from "fs";
import os from "os";
import path from "path";
import { supabase } from "../../config/supabase.js";
import { lireCycle, signaler, signalerLot, type Item } from "../../lib/cycles.js";
import { downloadAndUnzip } from "../automation/utils.js";

/**
 * CYCLE AUDITIONS — agent 1 : le veilleur.
 *
 * Sa seule tâche : tenir la liste de TOUTES les réunions de commission de l'Assemblée, et
 * dire où chacune en est. Il ne résume rien et n'appelle aucune IA.
 *
 * Jusqu'ici, la chaîne partait des comptes rendus qu'elle arrivait à lire : une réunion dont
 * la page répondait 503 ce jour-là, ou dont le compte rendu n'était qu'un renvoi vers la
 * vidéo, était sautée sans laisser de trace. Le veilleur part au contraire de l'agenda
 * officiel (open data de l'Assemblée), qui recense chaque réunion tenue, et confronte cette
 * liste à ce qui est réellement en ligne :
 *
 *   en_ligne      analyse détaillée publiée
 *   collecte      résumé court en base, analyse détaillée pas encore faite
 *   detecte       compte rendu annoncé, pas encore repris (le motif est noté : page en
 *                 erreur, compte rendu vide, simple retard)
 *   a_transcrire  aucun compte rendu écrit, mais une vidéo : à transcrire
 *   sans_source   ni compte rendu ni vidéo : rien ne peut être publié
 *
 * Les agents suivants sont les tâches existantes, inchangées : sync-commission-reports
 * (collecte), update-commissions (analyse) et transcribe-auditions (transcription).
 *
 * Usage : npx tsx src/scripts/agents/auditions-veilleur.ts [--jours=150] [--dry-run]
 */
const AGENT = "auditions-veilleur";
const AGENDA = "https://data.assemblee-nationale.fr/static/openData/repository/17/vp/reunions/Agenda.json.zip";
const JOURS = Number(process.argv.find(a => a.startsWith("--jours="))?.split("=")[1] || 150);
const DRY = process.argv.includes("--dry-run");
const UA = { "User-Agent": "LaPolitiqueBot/1.0 (contact@lapolitique.fr)" };
/** Délai au-delà duquel on n'attend plus de compte rendu écrit. */
const ATTENTE_CR_JOURS = 21;

function trouver(racine: string, nom: string): string | null {
  for (const e of fs.readdirSync(racine)) {
    const p = path.join(racine, e);
    if (fs.statSync(p).isDirectory()) { if (e === nom) return p; const r = trouver(p, nom); if (r) return r; }
  }
  return null;
}

function objetDe(r: any): string {
  const resume = r.ODJ?.resumeODJ?.item;
  if (resume) return (Array.isArray(resume) ? resume.join(" ; ") : String(resume)).replace(/\s+/g, " ").trim();
  let points = r.ODJ?.pointsODJ?.pointODJ;
  if (points && !Array.isArray(points)) points = [points];
  return (points ?? []).map((p: any) => p?.objet).filter(Boolean).join(" ; ").replace(/\s+/g, " ").trim();
}

/** Pourquoi un compte rendu annoncé n'est-il pas en base ? On va voir la page. */
async function sonder(ref: string): Promise<{ etape: string; erreur: string | null; lien?: string }> {
  try {
    // Le serveur de l'Assemblée répond volontiers 503 à des demandes rapprochées : on insiste
    // deux fois avant de conclure, sinon chaque passage inventerait des pannes.
    let r = await fetch(`https://www.assemblee-nationale.fr/dyn/opendata/${ref}.html`, { headers: UA, signal: AbortSignal.timeout(25000) });
    for (let essai = 0; essai < 2 && r.status >= 500; essai++) {
      await new Promise(x => setTimeout(x, 4000));
      r = await fetch(`https://www.assemblee-nationale.fr/dyn/opendata/${ref}.html`, { headers: UA, signal: AbortSignal.timeout(25000) });
    }
    await new Promise(x => setTimeout(x, 700));
    if (!r.ok) return { etape: "detecte", erreur: `La page du compte rendu répond HTTP ${r.status}.` };
    const t = (await r.text()).replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    if (/n.a pas fait l.objet d.un compte rendu/i.test(t)) {
      return { etape: "a_transcrire", erreur: null, lien: t.match(/https:\/\/assnat\.fr\/\w+/)?.[0] };
    }
    if (t.length < 800) return { etape: "detecte", erreur: "Compte rendu publié mais vide." };
    return { etape: "detecte", erreur: null };
  } catch (e: any) {
    return { etape: "detecte", erreur: `Page du compte rendu injoignable (${e.message}).` };
  }
}

async function main() {
  console.log(`=== Auditions · veilleur${DRY ? " (essai, rien n'est écrit)" : ""} ===`);
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "agenda-"));
  try {
    await downloadAndUnzip(AGENDA, dossier);
  } catch (e: any) {
    // Panne de l'open data : on ne conclut rien, le prochain passage reprendra.
    console.warn(`Agenda de l'Assemblée indisponible (${e?.message}) — passage ignoré.`);
    return;
  }
  const rdir = trouver(dossier, "reunion");
  if (!rdir) throw new Error("dossier « reunion » introuvable dans l'agenda");

  // Ce qui est réellement en base.
  const enBase = new Map<string, { analyse: boolean; organe: string | null; commission: string | null }>();
  for (let debut = 0; ; debut += 1000) {
    const { data, error } = await supabase.from("commission_reports")
      .select("ref, organe_ref, commission, analyzed_at").eq("chamber", "AN").range(debut, debut + 999);
    if (error) throw error;
    for (const r of data ?? []) enBase.set(r.ref, { analyse: !!r.analyzed_at, organe: r.organe_ref, commission: r.commission });
    if (!data || data.length < 1000) break;
  }
  const nomOrgane = new Map<string, string>();
  for (const v of enBase.values()) if (v.organe && v.commission) nomOrgane.set(v.organe, v.commission);

  const suivi = await lireCycle("auditions");
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const debut = new Date(Date.now() - JOURS * 864e5).toISOString().slice(0, 10);
  const nouveaux: (Pick<Item, "cycle" | "cle" | "etape"> & Partial<Item>)[] = [];
  const compte: Record<string, number> = {};
  let avances = 0;

  for (const f of fs.readdirSync(rdir)) {
    let r: any;
    try { r = JSON.parse(fs.readFileSync(path.join(rdir, f), "utf8")).reunion; } catch { continue; }
    if (r?.["@xsi:type"] !== "reunionCommission_type" || r.cycleDeVie?.etat !== "Confirmé") continue;
    const date = String(r.timeStampDebut || "").slice(0, 10);
    if (!date || date < debut || date > aujourdhui) continue;

    const ref: string | null = /^CRC/i.test(r.compteRenduRef || "") ? r.compteRenduRef : null;
    const filmee = r.captationVideo === "true";
    const age = (Date.now() - new Date(date).getTime()) / 864e5;
    const connu = suivi.get(r.uid);
    // Une réunion transcrite depuis sa vidéo est rangée sous son identifiant d'agenda.
    const base = (ref ? enBase.get(ref) : undefined) ?? enBase.get(r.uid);

    let etape: string, erreur: string | null = null, lien: string | undefined;
    if (base) etape = base.analyse ? "en_ligne" : "collecte";
    else if (ref) {
      // On ne retourne voir la page que si l'objet n'est pas déjà classé « à transcrire ».
      if (connu?.etape === "a_transcrire") { etape = "a_transcrire"; lien = connu.donnees?.lien; }
      else {
        const s = await sonder(ref); etape = s.etape; erreur = s.erreur; lien = s.lien;
        // Deux mois plus tard, une page absente ou vide ne viendra plus : l'Assemblée a
        // annoncé un compte rendu qu'elle n'a pas publié. On le constate, on n'attend plus.
        if (etape === "detecte" && erreur && age > 60) etape = "sans_source";
      }
    }
    else if (age < ATTENTE_CR_JOURS) etape = "detecte";
    else if (filmee) { etape = "a_transcrire"; erreur = "Aucun compte rendu écrit après trois semaines ; réunion filmée."; }
    else etape = "sans_source";
    compte[etape] = (compte[etape] || 0) + 1;

    const item = {
      cycle: "auditions" as const, cle: r.uid as string, etape, erreur,
      sujet: nomOrgane.get(r.organeReuniRef) ?? r.organeReuniRef ?? null,
      titre: objetDe(r).slice(0, 300) || null,
      source_url: ref ? `https://www.assemblee-nationale.fr/dyn/opendata/${ref}.html` : null,
      date_objet: date,
      donnees: { ref, organe_ref: r.organeReuniRef ?? null, filmee, ...(lien ? { lien } : {}) },
    };
    if (!connu) { nouveaux.push(item); continue; }
    if (DRY) continue;
    if (await signaler(AGENT, connu, item) === "avance") avances++;
  }
  if (!DRY) await signalerLot(AGENT, nouveaux);
  fs.rmSync(dossier, { recursive: true, force: true });

  console.log(`  ${nouveaux.length} réunion(s) nouvelle(s), ${avances} ont avancé.`);
  for (const [e, n] of Object.entries(compte).sort((a, b) => b[1] - a[1])) console.log(`    ${e.padEnd(13)} ${n}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
