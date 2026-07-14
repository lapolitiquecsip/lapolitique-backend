"""Positions des candidats via leurs sources officielles (Crawl4AI + DeepSeek).

Crawle des pages fiables (programmes officiels), en extrait la position par enjeu
avec l'URL comme source, et remplit public.candidate_positions (source_type=programme).
Ne remplace jamais une position issue d'un vote réel (source_type=vote), plus fiable.
"""
import os, json, asyncio, httpx
from openai import OpenAI
from crawl4ai import AsyncWebCrawler


def clean_env(key: str, required: bool = True) -> str:
    """Lit une variable d'env en retirant espaces et caractères non imprimables
    (les secrets GitHub sont souvent collés avec un retour à la ligne parasite)."""
    raw = os.getenv(key, "")
    cleaned = "".join(ch for ch in raw if ch.isprintable()).strip()
    if required and not cleaned:
        raise RuntimeError(f"Variable d'environnement {key} manquante")
    if raw != cleaned and raw:
        print(f"WARNING: {key} contenait des espaces/retours à la ligne — nettoyé automatiquement.")
    return cleaned


SUPABASE_URL = clean_env("SUPABASE_URL").rstrip("/")
SRK = clean_env("SUPABASE_SERVICE_ROLE_KEY")
ds = OpenAI(api_key=clean_env("DEEPSEEK_API_KEY"), base_url="https://api.deepseek.com")

PROPOSITIONS = {
    "immigration": "Durcir les règles de l'immigration",
    "securite-justice": "Renforcer la fermeté pénale (peines plus sévères)",
    "laicite": "Renforcer les restrictions sur les signes religieux dans l'espace public",
    "retraites": "Abroger la réforme portant l'âge légal à 64 ans",
    "fiscalite": "Augmenter les impôts sur les plus hauts patrimoines/revenus",
    "sante": "Augmenter fortement le financement public de la santé",
    "climat": "Imposer des contraintes écologiques fortes (interdictions, normes)",
    "nucleaire": "Développer l'énergie nucléaire",
    "ukraine-russie": "Soutenir militairement l'Ukraine face à la Russie",
    "europe-ue": "Approfondir l'intégration européenne",
    "institutions": "Instaurer la proportionnelle / une VIe République",
}

# Sources par candidat (extensible). Page programme du comparateur ÉlyséeScope
# (positions par enjeu, sourcées) + programme officiel quand connu.
def _es(slug):
    return f"https://www.elyseescope.com/candidat/{slug}/programme"

CANDIDATE_SOURCES = {
    "jean-luc-melenchon": [_es("jean-luc-melenchon"), "https://aec2027.fr/"],
    "marine-le-pen": [_es("marine-le-pen")],
    "bruno-retailleau": [_es("bruno-retailleau")],
    "edouard-philippe": [_es("edouard-philippe")],
    "gabriel-attal": [_es("gabriel-attal")],
    "xavier-bertrand": [_es("xavier-bertrand")],
    "nicolas-dupont-aignan": [_es("nicolas-dupont-aignan")],
    "florian-philippot": [_es("florian-philippot")],
    "francois-asselineau": [_es("francois-asselineau")],
    "delphine-batho": [_es("delphine-batho")],
    "jerome-guedj": [_es("jerome-guedj")],
    "karim-bouamrane": [_es("karim-bouamrane")],
    "nathalie-arthaud": [_es("nathalie-arthaud")],
    "anasse-kazib": [_es("anasse-kazib")],
}

HEADERS = {"apikey": SRK, "Authorization": f"Bearer {SRK}", "Content-Type": "application/json"}


async def crawl_all(urls):
    md = ""
    async with AsyncWebCrawler() as crawler:
        for url in urls:
            try:
                res = await crawler.arun(url=url)
                if getattr(res, "markdown", None):
                    md += f"\n\n# SOURCE {url}\n{res.markdown}"
            except Exception as e:
                print(f"  crawl échec {url}: {e}")
    return md


def extract_positions(name, text):
    issues_txt = "\n".join(f"- {s} : « {p} »" for s, p in PROPOSITIONS.items())
    sys = (
        "On te donne le TEXTE d'une source officielle (programme/positions) d'un·e candidat·e, et des PROPOSITIONS. "
        "Pour CHAQUE proposition, détermine sa position UNIQUEMENT d'après le texte.\n"
        "RÈGLES : n'utilise que le texte ; ne devine pas. stance = 'pour' (favorable), 'contre' (opposé), "
        "'nuance' (mitigé/conditionnel explicite), ou 'inconnu' si le texte ne dit rien d'exploitable. "
        "summary : 1 phrase factuelle et neutre citant ce que dit le texte (vide si inconnu).\n"
        'Réponds en français en JSON : { "positions": { "<slug>": { "stance": "...", "summary": "..." } } }'
    )
    resp = ds.chat.completions.create(
        model="deepseek-v4-flash",
        max_tokens=2500,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": sys},
            {"role": "user", "content": f"Candidat : {name}\n\nPROPOSITIONS :\n{issues_txt}\n\nTEXTE :\n{text[:45000]}"},
        ],
    )
    raw = resp.choices[0].message.content or ""
    try:
        return json.loads(raw[raw.index("{"): raw.rindex("}") + 1]).get("positions", {})
    except Exception:
        return {}


def existing_sources(slug):
    r = httpx.get(f"{SUPABASE_URL}/rest/v1/candidate_positions",
                  params={"candidate_slug": f"eq.{slug}", "select": "issue_slug,source_type"}, headers=HEADERS, timeout=20)
    return {row["issue_slug"]: row["source_type"] for row in (r.json() if r.status_code == 200 else [])}


def upsert(rows):
    if not rows:
        return
    httpx.post(f"{SUPABASE_URL}/rest/v1/candidate_positions",
               headers={**HEADERS, "Prefer": "resolution=merge-duplicates"}, json=rows, timeout=30)


async def main():
    print("--- POSITIONS via SOURCES WEB (Crawl4AI) ---")
    valid = {"pour", "contre", "nuance"}
    total = 0
    for slug, urls in CANDIDATE_SOURCES.items():
        md = await crawl_all(urls)
        if not md.strip():
            print(f"  (aucun contenu crawlé pour {slug})")
            continue
        positions = extract_positions(slug, md)
        prev = existing_sources(slug)
        rows = []
        for issue, prop in PROPOSITIONS.items():
            if prev.get(issue) == "vote":   # ne jamais écraser un vote réel
                continue
            p = positions.get(issue) or {}
            if p.get("stance") not in valid:
                continue
            rows.append({
                "candidate_slug": slug, "issue_slug": issue, "stance": p["stance"],
                "summary": p.get("summary") or None, "source_url": urls[0], "source_type": "programme",
            })
        upsert(rows)
        total += len(rows)
        print(f"> ✓ {slug} : {len(rows)} position(s) sourcée(s) programme")
    print(f"--- TERMINE. {total} positions (web) écrites. ---")


if __name__ == "__main__":
    asyncio.run(main())
