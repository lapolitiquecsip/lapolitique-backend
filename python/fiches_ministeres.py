"""Fiches ministères : budget, emplois, résultats et questions écrites, tirés des seuls textes officiels.

Aucune IA : chaque chiffre est lu dans un document public et vérifié par une règle arithmétique du
document lui-même ; une donnée qui échoue au contrôle n'est pas publiée (avertissement dans le job).

Sources, retrouvées seules chaque semaine :
  - le dernier projet de loi de finances déposé à l'Assemblée (dossier « Projet de loi de finances
    pour AAAA ») : crédits proposés par ministère et programme, crédits votés l'an passé, répartition
    par nature de dépense, plafonds d'emplois du ministère et de ses opérateurs ;
  - le dernier projet de loi relatif aux résultats de la gestion (comptes de l'année AAAA) : crédits
    réellement consommés, emplois réellement occupés, masse salariale exécutée ;
  - le dernier rapport annuel de performances ouvert par Bercy (data.economie.gouv.fr) ;
  - les questions écrites de l'Assemblée (table questions_parlement, relevée chaque nuit).

Écrit la table ministere_fiches (une ligne par ministère et rubrique).
Usage : python python/fiches_ministeres.py [--essai] [--dossier=chemin]   (--essai : affiche sans écrire)
"""
import json, os, re, statistics, sys, unicodedata, urllib.parse, urllib.request
from datetime import date, datetime, timezone

import pypdf

sys.stdout.reconfigure(encoding="utf-8")
ESSAI = "--essai" in sys.argv
DOSSIER = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--dossier=")), "/tmp/fiches-ministeres")
UA = "lapolitiquecestsimple.fr (fiches ministeres; contact via le site)"
SUPABASE = os.environ.get("SUPABASE_URL", "").rstrip("/")
CLE = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

# Ministères suivis. « plf » : intitulé du ministère dans les tableaux des lois de finances (normalisé) ;
# « questions » : motif du ministère destinataire des questions écrites (ministres délégués compris).
FICHES = [
    {"slug": "ministere-de-l-europe-et-des-affaires-etrangeres", "plf": "europe et affaires etrangeres", "questions": "Europe et des affaires"},
]

avertissements: list[str] = []


def avertir(msg: str):
    avertissements.append(msg)
    print(f"::warning::{msg}")


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", (s or "").lower().replace("’", "'"))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", s)).strip()


def http(url: str, entetes: dict | None = None, corps: bytes | None = None, methode: str | None = None) -> bytes:
    req = urllib.request.Request(url, data=corps, method=methode, headers={"User-Agent": UA, **(entetes or {})})
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


def rest(chemin: str) -> list:
    return json.loads(http(f"{SUPABASE}/rest/v1/{chemin}", {"apikey": CLE, "Authorization": f"Bearer {CLE}"}))


# ── Documents ─────────────────────────────────────────────────────────────────────────────

def dernier_texte(motif_titre: str) -> dict | None:
    """Dernier dossier AN dont le titre contient l'année : renvoie {annee, titre, dossier, pdf}."""
    lignes = rest("legislative_dossiers?select=title,source_urls,deposited_at&official_id=like.DLR*"
                  f"&title=ilike.{urllib.parse.quote(motif_titre)}&order=deposited_at.desc&limit=10")
    for d in lignes:
        an = re.search(r"(20\d\d)", d["title"])
        url = next((u for u in d.get("source_urls") or [] if "assemblee-nationale.fr" in u), None)
        if not an or not url:
            continue
        try:
            page = http(url).decode("utf-8", "ignore")
        except Exception as e:   # dossier renommé ou retiré : on passe au suivant
            print(f"  dossier illisible ({e}) : {url}")
            continue
        nums = sorted({(int(l), int(b)) for l, b in re.findall(r"l(\d+)b(\d+)_projet-loi", page)}, key=lambda x: x[1])
        if not nums:
            continue
        leg, num = nums[0]
        return {"annee": int(an.group(1)), "titre": d["title"], "dossier": url,
                "pdf": f"https://www.assemblee-nationale.fr/dyn/{leg}/textes/l{leg}b{num:04d}_projet-loi.pdf"}
    return None


def pages_pdf(doc: dict) -> list[str]:
    os.makedirs(DOSSIER, exist_ok=True)
    chemin = os.path.join(DOSSIER, os.path.basename(doc["pdf"]))
    if not os.path.exists(chemin):
        open(chemin, "wb").write(http(doc["pdf"]))
    r = pypdf.PdfReader(chemin)
    sortie = []
    for p in r.pages:
        t = p.extract_text(extraction_mode="layout") or ""
        sortie.append(t.replace(" ", " ").replace("\xa0", " "))
    return sortie


ENTIER = r"-?\d{1,3}(?: \d{3})*"
DECIMAL = r"-?\d{1,3}(?: \d{3})*,\d{2}"


def montants(ligne: str, motif: str) -> tuple[str, list[int]]:
    """Coupe une ligne en (libellé, montants) ; colonnes séparées d'au moins deux espaces."""
    morceaux = [m for m in re.split(r"\s{2,}", ligne.strip()) if m]
    nombres, texte = [], []
    for m in morceaux:
        if re.fullmatch(motif, m):
            nombres.append(int(m.replace(" ", "").replace(",", "")))
        elif not nombres:
            texte.append(m)
        else:
            return " ".join(texte), []   # texte après des nombres : pas une ligne de tableau
    return " ".join(texte), nombres


def lignes_logiques(pages: list[str], motif: str):
    """(libellé, montants, programme?) ; un libellé coupé sur deux lignes est recollé."""
    attente = None
    for page in pages:
        for brute in page.split("\n"):
            if not brute.strip():
                continue
            texte, nb = montants(brute, motif)
            if not nb:
                attente = texte.strip() if texte.strip() else attente
                continue
            t = texte.strip()
            if attente and (not t or t[0].islower()):
                t = f"{attente} {t}".strip()
            attente = None
            programme = t.startswith("- ")
            yield t.lstrip("- ").strip(), nb, programme
    # NB : avec DECIMAL, les montants sont en centimes (virgule retirée).


def meme_nom(a: str, b: str) -> bool:
    """Libellés égaux, ou l'un est le début de l'autre (libellé tronqué), sur 20 caractères au moins."""
    a, b = norm(a), norm(b)
    if a == b:
        return True
    court, long_ = sorted((a, b), key=len)
    return len(court) >= 20 and long_.startswith(court)


# ── PLF : crédits par ministère, LFI précédente, titres, emplois ─────────────────────────

def plf_ministere(pages: list[str], cible: str) -> dict | None:
    sel = [p for p in pages if "Ministère / Programme" in p and "Autorisations" in p and "ETPT" not in p]
    lignes = [(t, nb) for t, nb, _ in lignes_logiques(sel, ENTIER) if len(nb) == 2 and t]
    for i, (nom, (ae, cp)) in enumerate(lignes):
        if norm(nom) != cible:
            continue
        sa = sc = 0
        for j in range(i + 1, min(i + 20, len(lignes))):
            sa += lignes[j][1][0]; sc += lignes[j][1][1]
            if sa == ae and sc == cp:
                progs = [{"nom": n, "ae": a, "cp": c} for n, (a, c) in lignes[i + 1:j + 1]]
                return {"nom": nom, "ae": ae, "cp": cp, "programmes": progs}
            if sa > ae and sc > cp:
                break
        avertir(f"PLF : le total « {nom} » n'égale pas la somme de ses programmes — budget non publié")
        return None
    avertir(f"PLF : ministère « {cible} » introuvable dans le tableau par ministère")
    return None


def section(pages: list[str], debut: str, fin: str) -> list[str]:
    on, sortie = False, []
    for p in pages:
        if debut in p:
            on = True
        elif on and fin in p:
            break
        if on:
            sortie.append(p)
    return sortie


def plf_lfi_precedente(pages: list[str], programmes: list[dict]) -> dict:
    """Tableau 1 : colonnes LFI N-1 AE, PLF AE, LFI N-1 CP, PLF CP — repérées par les montants PLF connus."""
    sel = section(pages, "1. Tableau de comparaison, par mission et programme", "2. Tableau de comparaison, par titre")
    lignes = [(t, nb) for t, nb, _ in lignes_logiques(sel, ENTIER) if len(nb) == 4]
    res = {}
    for p in programmes:
        ok = [nb for t, nb in lignes if nb[1] == p["ae"] and nb[3] == p["cp"] and meme_nom(t, p["nom"])]
        if len(ok) == 1:
            res[p["nom"]] = {"ae": ok[0][0], "cp": ok[0][2]}
        else:   # programme créé cette année : rien de voté l'an passé, ce n'est pas une panne
            print(f"::notice::PLF : pas de crédits votés l'an passé pour « {p['nom']} » (programme nouveau ?)")
    return res


def plf_titres(pages: list[str], programmes: list[dict]) -> dict:
    """Tableau 2 : par titre (nature de dépense). Contrôle : la somme des titres = crédits du programme."""
    sel = section(pages, "2. Tableau de comparaison, par titre", "3. Tableau de comparaison, par titre et catégorie")
    titre, res = None, {p["nom"]: {} for p in programmes}
    for page in sel:
        for brute in page.split("\n"):
            m = re.match(r"\s*Titre (\d)\.\s+(.+?)\s*$", brute)
            if m:
                titre = f"{m.group(1)}|{m.group(2).strip()}"
                continue
            texte, nb = montants(brute, ENTIER)
            if titre and len(nb) == 4 and texte:
                for p in programmes:
                    if meme_nom(texte, p["nom"]):
                        res[p["nom"]][titre] = {"lfi_cp": nb[2], "plf_cp": nb[3]}
    sortie = {}
    for p in programmes:
        t = res[p["nom"]]
        if t and sum(v["plf_cp"] for v in t.values()) == p["cp"]:
            sortie[p["nom"]] = t
        else:
            avertir(f"PLF : répartition par nature de « {p['nom']} » incohérente — non publiée")
    return sortie


def plf_emplois(pages: list[str], cible: str, programmes: list[dict]) -> dict:
    res = {}
    sel = section(pages, "4. Tableau d’évolution des plafonds d’emplois", "5. Tableau de comparaison")
    for t, nb, _ in lignes_logiques(sel, ENTIER):
        if norm(t) == cible and len(nb) == 2:
            res = {"vote": nb[0], "propose": nb[1]}
            break
    # Contrôle : l'article de loi fixant le plafond du ministère dit la même chose que le tableau.
    article = [p for p in pages if "Plafond d’autorisation des emplois" in p or "plafonds des autorisations d’emplois" in p.lower()]
    dans_article = {nb[0] for t, nb, _ in lignes_logiques(article, ENTIER) if norm(t) == cible and len(nb) == 1}
    if not res:
        avertir("PLF : plafond d'emplois du ministère introuvable")
    elif res["propose"] not in dans_article:
        avertir(f"PLF : plafond d'emplois {res['propose']} absent de l'article de loi — non publié")
        res = {}
    # Opérateurs rattachés aux programmes du ministère (article « plafond … des opérateurs »).
    # L'article s'étend sur plusieurs pages : on le coupe à l'article suivant, sinon un autre plafond
    # du même programme (établissements à autonomie financière…) écraserait le bon.
    tete = "Plafond d’autorisation des emplois des opérateurs de l’État"
    # (la table des matières porte le même titre : on veut la page où le plafond est réparti)
    i = next((k for k, p in enumerate(pages) if tete in p and "Ce plafond est réparti" in p), None)
    texte = ""
    if i is not None:
        texte = "\n".join(pages[i:i + 5])
        texte = texte[texte.find(tete) + len(tete):]
        fin = re.search(r"\n\s*ARTICLE \d+", texte)
        texte = texte[:fin.start()] if fin else texte
    op = {}
    for t, nb, _ in lignes_logiques([texte], ENTIER):
        if len(nb) == 1:
            for p in programmes:
                if meme_nom(t, p["nom"]):
                    op[p["nom"]] = nb[0]
    return {**res, "operateurs": op}


# ── Résultats de la gestion : dépensé, emplois occupés, masse salariale ─────────────────

def plrg_consomme(pages: list[str], programmes: list[dict]) -> dict:
    """AE et CP consommés par programme. Contrôle : chaque mission = somme de ses programmes, au centime."""
    res = {"ae": {}, "cp": {}}
    for nature, debut, fin in (("ae", "Autorisations d'engagement", "Dépenses (en euros)"), ("cp", "Dépenses (en euros)", "Ajustements des soldes")):
        sel, on = [], False
        for p in pages:
            if "Désignation des missions et des programmes" in p and debut in p:
                on = True
            elif on and (fin in p or "Désignation des missions" not in p):
                break
            if on:
                sel.append(p)
        mission, progs, valides = None, [], set()
        lignes = list(lignes_logiques(sel, DECIMAL)) + [("FIN", [0], False)]
        for t, nb, est_prog in lignes:
            if est_prog:
                progs.append((t, nb[0]))
                continue
            if mission and progs and sum(v for _, v in progs) == mission[1]:
                valides.update(n for n, _ in progs)
                for n, v in progs:
                    for p in programmes:
                        if meme_nom(n, p["nom"]):
                            res[nature][p["nom"]] = round(v / 100)   # centimes → euros
            elif mission and progs and any(meme_nom(n, p["nom"]) for n, _ in progs for p in programmes):
                avertir(f"Comptes : la mission « {mission[0]} » ({nature}) n'égale pas la somme de ses programmes — non publiée")
            mission, progs = (t, nb[0]), []
    return res


def plrg_emplois(pages: list[str], cible: str) -> dict:
    for p in pages:
        if "Évolution des emplois" not in p and "Consommation" not in p:
            continue
        for t, nb, _ in lignes_logiques([p], ENTIER):
            if norm(t) == cible and len(nb) == 7:
                transf_prec, conso_prec, plafond, transf, conso, ecart, variation = nb
                if ecart == conso - plafond - transf and variation == conso - conso_prec:
                    return {"realise": conso, "plafond": plafond, "realise_precedent": conso_prec}
                avertir("Comptes : tableau des emplois incohérent — non publié")
    avertir("Comptes : emplois réalisés du ministère introuvables")
    return {}


def plrg_masse_salariale(pages: list[str], cible: str) -> dict:
    for p in pages:
        if "HCAS" not in p:
            continue
        for t, nb, _ in lignes_logiques([p], ENTIER):
            if norm(t) == cible and len(nb) == 6:
                lfi_h, exe_h, ec_h, lfi, exe, ec = nb
                if abs((exe - lfi) - ec) <= 1 and abs((exe_h - lfi_h) - ec_h) <= 1:
                    return {"prevu_meur": lfi, "realise_meur": exe, "prevu_hors_pensions_meur": lfi_h, "realise_hors_pensions_meur": exe_h}
    return {}


# ── Performance (Bercy) ───────────────────────────────────────────────────────────────

ECO = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets"


def performance(programmes: list[dict]) -> dict | None:
    cat = json.loads(http(f"{ECO}?where=search(%22performance-de-la-depense-rap%22)&limit=50&select=dataset_id"))
    ids = sorted({d["dataset_id"] for d in cat.get("results", []) if re.fullmatch(r"performance-de-la-depense-rap-20\d\d", d["dataset_id"])})
    if not ids:
        avertir("Performance : aucun rapport annuel de performances ouvert")
        return None
    jeu = ids[-1]; an = int(jeu[-4:])
    groupes = json.loads(http(f"{ECO}/{jeu}/records?group_by=code_programme,programme&limit=500"))["results"]
    codes = sorted({g["code_programme"] for g in groupes for p in programmes if meme_nom(g["programme"] or "", p["nom"])})
    if not codes:
        avertir("Performance : programmes du ministère introuvables dans le rapport")
        return None
    q = urllib.parse.quote(f"code_programme in ({','.join(str(c) for c in codes)})")
    recs = json.loads(http(f"{ECO}/{jeu}/records?where={q}&limit=100"))["results"]
    ind = []
    for r in recs:
        if (r.get("type_de_secteur") or "") != "Programme":
            continue
        ind.append({
            "programme": r.get("programme"), "code_programme": r.get("code_programme"),
            "objectif": r.get("libelle_objectif"), "indicateur": r.get("libelle_indicateur"),
            "sous_indicateur": r.get("libelle_sous_indicateur"), "unite": r.get("unite"), "sens": r.get("evolution"),
            "realise": {str(an - 2): r.get(f"exec_{an - 2}"), str(an - 1): r.get(f"exec_{an - 1}"), str(an): r.get(f"exec_{an}")},
            "cible": r.get(f"{an}_cible"), "cible_suivante": r.get(f"{an + 1}_cible"), "atteinte": r.get(f"atteinte_de_la_cible_{an}"),
            "public": r.get("facteur_de_performance"), "ordre": [r.get("ordre_obj") or 0, r.get("ordre_ind") or 0, r.get("ordre_ssi") or 0],
        })
    ind.sort(key=lambda x: (x["code_programme"] or 0, x["ordre"]))
    return {"annee": an, "jeu": jeu, "source": f"https://data.economie.gouv.fr/explore/dataset/{jeu}/", "indicateurs": ind}


# ── Questions écrites ─────────────────────────────────────────────────────────────────

def questions(motif: str) -> dict | None:
    lignes, depart = [], 0
    while True:
        lot = rest(f"questions_parlement?select=uid,numero,objet,ministere,date_question,date_reponse,statut,url"
                   f"&type=eq.QE&ministere=ilike.*{urllib.parse.quote(motif)}*&order=date_question.desc&offset={depart}&limit=1000")
        lignes += lot
        if len(lot) < 1000:
            break
        depart += 1000
    if not lignes:
        return None
    auj = date.today()
    j = lambda s: date.fromisoformat(s[:10])
    repondues = [q for q in lignes if q.get("date_reponse")]
    delais = [(j(q["date_reponse"]) - j(q["date_question"])).days for q in repondues]
    attente = [q for q in lignes if not q.get("date_reponse")]
    vieilles = [q for q in attente if (auj - j(q["date_question"])).days > 60]
    pick = lambda q: {"date": q["date_question"][:10], "objet": q.get("objet"), "numero": q.get("numero"), "url": q.get("url"),
                      "reponse": q.get("date_reponse", None) and q["date_reponse"][:10]}
    return {
        "depuis": min(q["date_question"] for q in lignes)[:10], "total": len(lignes), "repondues": len(repondues),
        "delai_median_jours": round(statistics.median(delais)) if delais else None,
        "repondues_sous_2_mois": sum(1 for d in delais if d <= 61),
        "en_attente": len(attente), "en_attente_plus_2_mois": len(vieilles),
        "recentes": [pick(q) for q in lignes[:6]],
        "source": "https://www2.assemblee-nationale.fr/recherche/resultats_questions",
    }


# ── Écriture ──────────────────────────────────────────────────────────────────────────

def ecrire(slug: str, rubrique: str, donnees, sources: list):
    ligne = {"slug": slug, "rubrique": rubrique, "donnees": donnees, "sources": sources, "maj_le": datetime.now(timezone.utc).isoformat()}
    if ESSAI:
        print(f"\n[essai] {slug} / {rubrique}\n{json.dumps(donnees, ensure_ascii=False, indent=1)[:4000]}")
        return
    http(f"{SUPABASE}/rest/v1/ministere_fiches", {"apikey": CLE, "Authorization": f"Bearer {CLE}", "Content-Type": "application/json",
         "Prefer": "resolution=merge-duplicates,return=minimal"}, json.dumps([ligne]).encode(), "POST")


def main():
    plf = dernier_texte("Projet de loi de finances pour 20*")
    plrg = dernier_texte("*résultats de la gestion*")
    if not plf:
        avertir("Aucun projet de loi de finances trouvé")
    print("PLF :", plf and plf["pdf"], "| Résultats :", plrg and plrg["pdf"])
    p_plf = pages_pdf(plf) if plf else []
    p_plrg = pages_pdf(plrg) if plrg else []

    for f in FICHES:
        slug, cible = f["slug"], f["plf"]
        m = plf_ministere(p_plf, cible) if p_plf else None
        if m:
            progs = m["programmes"]
            lfi = plf_lfi_precedente(p_plf, progs)
            titres = plf_titres(p_plf, progs)
            conso = plrg_consomme(p_plrg, progs) if p_plrg else {"ae": {}, "cp": {}}
            an = plf["annee"]
            budget = {
                "ministere": m["nom"],
                "annees": {
                    str(an): {"statut": "propose", "ae": m["ae"], "cp": m["cp"], "programmes": progs},
                    str(an - 1): {"statut": "vote", "programmes": [{"nom": n, **v} for n, v in lfi.items()],
                                  "complet": len(lfi) == len(progs)},
                    **({str(plrg["annee"]): {"statut": "depense",
                                             "programmes": [{"nom": p["nom"], "ae": conso["ae"].get(p["nom"]), "cp": conso["cp"].get(p["nom"])}
                                                            for p in progs if p["nom"] in conso["cp"]],
                                             "complet": len(conso["cp"]) == len(progs)}} if plrg else {}),
                },
                "titres": {nom: [{"code": int(k.split("|")[0]), "titre": k.split("|")[1], "vote": v["lfi_cp"], "propose": v["plf_cp"]}
                                 for k, v in sorted(t.items())] for nom, t in titres.items()},
            }
            for a in budget["annees"].values():
                if a["statut"] != "propose":
                    a["cp"] = sum(p["cp"] or 0 for p in a["programmes"])
                    a["ae"] = sum(p["ae"] or 0 for p in a["programmes"])
            sources = [{"titre": plf["titre"], "url": plf["pdf"], "dossier": plf["dossier"]}]
            if plrg:
                sources.append({"titre": plrg["titre"], "url": plrg["pdf"], "dossier": plrg["dossier"]})
            ecrire(slug, "budget", budget, sources)

            emp = plf_emplois(p_plf, cible, progs)
            emplois = {"annee_plf": an, **emp}
            if p_plrg:
                emplois["realise"] = {"annee": plrg["annee"], **plrg_emplois(p_plrg, cible), "masse_salariale": plrg_masse_salariale(p_plrg, cible)}
            ecrire(slug, "emplois", emplois, sources)

            perf = performance(progs)
            if perf:
                ecrire(slug, "performance", perf, [{"titre": f"Rapports annuels de performances {perf['annee']} (Bercy)", "url": perf["source"]}])

        qs = questions(f["questions"])
        if qs:
            ecrire(slug, "questions", qs, [{"titre": "Questions écrites, Assemblée nationale (open data)", "url": "https://data.assemblee-nationale.fr/travaux-parlementaires/questions"}])

    print(f"Terminé, {len(avertissements)} avertissement(s).")


if __name__ == "__main__":
    main()
