"""
Portraits détourés en noir et blanc pour les visuels Instagram (Rose, graphiste — 25/11/2026).

Pour chaque personnalité : la photo de sa fiche (Wikimedia Commons le plus souvent) est détourée par
le modèle U²-Net « human_seg » (licence Apache 2.0, onnxruntime, sans IA générative), passée en noir
et blanc contrasté, recadrée, puis rangée dans le stockage Supabase « publications/portraits/<slug>.png »
avec son crédit (auteur + licence lus sur Commons) dans « portraits/<slug>.json ». Une fois par personne.

    python scripts/visuels/detourer.py --modele chemin/u2net_human_seg.onnx [--slug dominique-de-villepin] [--sortie dossier] [--refaire]

Sans --slug : tous les candidats déclarés qui ont une photo et pas encore de portrait.
Modèle : https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net_human_seg.onnx
Variables : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (ou .env du dépôt).
"""
import argparse, io, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageFilter, ImageOps

UA = {"User-Agent": "LPCS-visuels/1.0 (contact via lapolitiquecestsimple.fr)"}


def env():
    e = dict(os.environ)
    chemin = os.path.join(os.path.dirname(__file__), "..", "..", ".env")
    if os.path.exists(chemin):
        for l in open(chemin, encoding="utf-8-sig"):
            if "=" in l and not l.lstrip().startswith("#"):
                k, v = l.split("=", 1)
                e.setdefault(k.strip(), v.strip().strip('"'))
    return e


E = env()
URL, CLE = E["SUPABASE_URL"].rstrip("/"), E["SUPABASE_SERVICE_ROLE_KEY"]


def rest(chemin):
    r = urllib.request.Request(f"{URL}/rest/v1/{chemin}", headers={"apikey": CLE, "Authorization": f"Bearer {CLE}"})
    return json.load(urllib.request.urlopen(r, timeout=30))


def deposer(nom, contenu, type_):
    r = urllib.request.Request(f"{URL}/storage/v1/object/publications/{nom}", data=contenu, method="POST",
                               headers={"apikey": CLE, "Authorization": f"Bearer {CLE}", "Content-Type": type_, "x-upsert": "true"})
    urllib.request.urlopen(r, timeout=60)
    return f"{URL}/storage/v1/object/public/publications/{nom}"


def existe(nom):
    try:
        urllib.request.urlopen(urllib.request.Request(f"{URL}/storage/v1/object/public/publications/{nom}", method="HEAD"), timeout=20)
        return True
    except Exception:
        return False


def telecharger(url):
    for essai in range(5):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()
        except urllib.error.HTTPError as e:
            if e.code not in (429, 503) or essai == 4:
                raise
            time.sleep(int(e.headers.get("Retry-After") or 0) or 8 * (essai + 1))


def credit_commons(url):
    """Auteur et licence d'un fichier Wikimedia Commons (None si ce n'en est pas un)."""
    m = re.search(r"/commons/(?:thumb/)?[0-9a-f]/[0-9a-f]{2}/([^/?]+)", url)
    if not m:
        return None
    fichier = urllib.parse.unquote(m.group(1))
    q = urllib.parse.urlencode({"action": "query", "titles": f"File:{fichier}", "prop": "imageinfo", "iiprop": "extmetadata|url", "format": "json"})
    d = json.load(urllib.request.urlopen(urllib.request.Request(f"https://commons.wikimedia.org/w/api.php?{q}", headers=UA), timeout=30))
    page = next(iter(d["query"]["pages"].values()))
    meta = (page.get("imageinfo") or [{}])[0].get("extmetadata", {})
    nettoie = lambda s: re.sub(r"<[^>]+>", "", s or "").strip()
    return {"auteur": nettoie(meta.get("Artist", {}).get("value")) or None,
            "licence": nettoie(meta.get("LicenseShortName", {}).get("value")) or None,
            "source": f"https://commons.wikimedia.org/wiki/File:{urllib.parse.quote(fichier)}"}


def original_non_recadre(url):
    """Les photos « …_cropped » de Commons coupent souvent les cheveux ou les épaules : on prend
    l'original quand il existe (le détourage recadre de toute façon)."""
    m = re.search(r"/commons/(?:thumb/)?[0-9a-f]/[0-9a-f]{2}/([^/?]+)", url)
    if not m:
        return None
    fichier = urllib.parse.unquote(m.group(1))
    autre = re.sub(r"(?i)[ _]?\(?cropped\)?(?=\.\w+$)|[ _]crop(?=\.\w+$)", "", fichier)
    if autre == fichier:
        return None
    q = urllib.parse.urlencode({"action": "query", "titles": f"File:{autre}", "prop": "imageinfo", "iiprop": "url", "iiurlwidth": 2000, "format": "json"})
    d = json.load(urllib.request.urlopen(urllib.request.Request(f"https://commons.wikimedia.org/w/api.php?{q}", headers=UA), timeout=30))
    page = next(iter(d["query"]["pages"].values()))
    info = (page.get("imageinfo") or [{}])[0]
    return info.get("thumburl") or info.get("url")


def masque(session, image):
    """U²-Net : masque de la personne, à la taille de l'image. Bord NET (retour d'Hippolyte du 25/11 :
    « l'image ne doit pas être floue autour ») : transition de quelques pixels seulement."""
    petit = image.convert("RGB").resize((320, 320), Image.LANCZOS)
    x = np.asarray(petit, dtype=np.float32)
    x = x / max(x.max(), 1e-6)
    x = (x - np.array([0.485, 0.456, 0.406])) / np.array([0.229, 0.224, 0.225])
    x = x.transpose(2, 0, 1)[None].astype(np.float32)
    sortie = session.run(None, {session.get_inputs()[0].name: x})[0][0, 0]
    sortie = (sortie - sortie.min()) / max(sortie.max() - sortie.min(), 1e-6)
    m = Image.fromarray((sortie * 255).astype(np.uint8)).resize(image.size, Image.BICUBIC)
    m = m.filter(ImageFilter.GaussianBlur(0.6))
    return m.point(lambda v: 0 if v < 105 else 255 if v > 150 else int((v - 105) * 255 / 45))


def detourer(session, contenu):
    """Renvoie (portrait RGBA noir et blanc, qualité) ; qualité dit si la personne touche un bord
    de la photo (coupée), et quelle part de l'image elle occupe."""
    image = Image.open(io.BytesIO(contenu))
    image = ImageOps.exif_transpose(image).convert("RGB")
    if max(image.size) > 2000:
        image.thumbnail((2000, 2000), Image.LANCZOS)
    m = masque(session, image)
    A = np.asarray(m, dtype=np.float32)
    qualite = {
        "touche_haut": float((A[0, :] > 128).mean()), "touche_gauche": float((A[:, 0] > 128).mean()),
        "touche_droite": float((A[:, -1] > 128).mean()), "aire": float((A > 128).mean()),
        "largeur": image.size[0], "hauteur": image.size[1],
    }
    gris = ImageOps.autocontrast(ImageOps.grayscale(image), cutoff=1.5)
    # Noir et blanc « presse », comme les visuels faits main : contrasté et net.
    gris = gris.point(lambda v: int(255 * ((v / 255) ** 1.15)))
    gris = gris.filter(ImageFilter.UnsharpMask(radius=2, percent=70, threshold=2))
    rgba = Image.merge("RGBA", (gris, gris, gris, m))
    boite = m.point(lambda v: 255 if v > 128 else 0).getbbox()
    if not boite:
        return rgba, qualite
    g, h, d, b = boite
    # Tête et épaules : on coupe SEULEMENT en bas (le bas du portrait est posé sur le bord de la
    # slide). Les contours gauche et droit restent ceux de la personne, sans fondu.
    haut = A[h + int(0.05 * (b - h)): h + int(0.2 * (b - h)) + 1, :]
    xs = np.where(haut.max(axis=0) > 128)[0]
    tete = max(xs.max() - xs.min(), 40) if len(xs) else (d - g) / 2.5
    qualite["tete"] = int(tete)
    return rgba.crop((g, h, d, min(b, h + int(tete * 2.6)))), qualite


DATE = re.compile(r"(20\d\d)[-:](\d\d)[-:](\d\d)")


def _api(params):
    """API de Commons, avec patience : Wikimedia freine les rafales (429), on réessaie en espaçant."""
    q = urllib.parse.urlencode({**params, "format": "json", "maxlag": 5})
    for essai in range(5):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(f"https://commons.wikimedia.org/w/api.php?{q}", headers=UA), timeout=40))
        except urllib.error.HTTPError as e:
            if e.code not in (429, 503) or essai == 4:
                raise
            time.sleep(int(e.headers.get("Retry-After") or 0) or 8 * (essai + 1))


def photos_recentes(nom, combien=8):
    """Les photos de Wikimedia Commons les plus récentes d'une personne (licence libre, assez
    grandes), de la plus récente à la plus ancienne : [(date de prise de vue, url 1800 px, page)].
    Sources : la catégorie Commons de la personne (et ses sous-catégories « … in 2025 ») + la recherche."""
    titres = set()
    cats = [f"Category:{nom}"]
    try:
        sous = _api({"action": "query", "list": "categorymembers", "cmtitle": cats[0], "cmtype": "subcat", "cmlimit": 50})
        cats += [c["title"] for c in sous.get("query", {}).get("categorymembers", []) if re.search(r"20(2[3-9]|3\d)", c["title"])]
        for c in cats:
            d = _api({"action": "query", "list": "categorymembers", "cmtitle": c, "cmtype": "file", "cmsort": "timestamp", "cmdir": "desc", "cmlimit": 60})
            titres |= {m["title"] for m in d.get("query", {}).get("categorymembers", [])}
    except Exception:
        pass
    try:
        d = _api({"action": "query", "list": "search", "srsearch": f'filetype:bitmap "{nom}"', "srnamespace": 6, "srlimit": 50})
        titres |= {m["title"] for m in d.get("query", {}).get("search", [])}
    except Exception:
        pass
    titres = [t for t in titres if re.search(r"\.(jpe?g|png|webp|tiff?)$", t, re.I)]
    sortie = []
    for i in range(0, len(titres), 40):
        d = _api({"action": "query", "titles": "|".join(titres[i:i + 40]), "prop": "imageinfo", "iiprop": "url|size|extmetadata", "iiurlwidth": 1800})
        for p in (d.get("query", {}).get("pages", {}) or {}).values():
            info = (p.get("imageinfo") or [{}])[0]
            meta = info.get("extmetadata", {})
            licence = (meta.get("LicenseShortName", {}).get("value") or "").lower()
            if not any(x in licence for x in ("cc", "public domain", "domaine public", "pd")) or info.get("width", 0) < 900:
                continue
            brut = " ".join(str(meta.get(k, {}).get("value") or "") for k in ("DateTimeOriginal", "DateTime")) + " " + p.get("title", "")
            m = DATE.search(brut)
            if m:
                sortie.append((f"{m.group(1)}-{m.group(2)}-{m.group(3)}", info.get("thumburl") or info.get("url"), info.get("descriptionurl")))
        time.sleep(1)
    sortie.sort(reverse=True)
    return sortie[:combien]


def meilleure_photo(session, nom, depuis="2023-01-01"):
    """La photo récente la plus exploitable : la plus récente où la personne est seule, entière
    (ni coupée en haut ni sur les côtés) et assez grande. None si aucune ne convient."""
    for date, url, page in photos_recentes(nom):
        if date < depuis:
            break
        try:
            portrait, q = detourer(session, telecharger(url))
        except Exception:
            continue
        time.sleep(2)
        if q["touche_haut"] > 0.01 or q["touche_gauche"] > 0.03 or q["touche_droite"] > 0.03:
            continue
        if not (0.06 < q["aire"] < 0.6) or q.get("tete", 0) < 160:
            continue
        return portrait, url, page, date
    return None


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--modele", required=True)
    a.add_argument("--slug")
    a.add_argument("--sortie")
    a.add_argument("--refaire", action="store_true")
    a.add_argument("--fiche", action="store_true", help="prendre la photo de la fiche du site, pas la plus récente de Commons")
    o = a.parse_args()
    session = ort.InferenceSession(o.modele, providers=["CPUExecutionProvider"])
    filtre = f"&slug=eq.{o.slug}" if o.slug else "&status=eq.declared"
    gens = rest(f"presidential_candidates?select=slug,full_name,photo_url,photo_credit&photo_url=not.is.null{filtre}")
    for g in gens:
        nom = f"portraits/{g['slug']}.png"
        if not o.refaire and not o.sortie and existe(nom):
            print(f"déjà fait : {g['slug']}")
            continue
        try:
            png = io.BytesIO()
            choix = meilleure_photo(session, g["full_name"]) if not o.fiche else None
            if choix:
                portrait, source, page, date = choix
                print(f"photo récente : {date} {page}")
            else:
                source = g["photo_url"]
                try:
                    source = original_non_recadre(source) or source
                except Exception:
                    pass
                portrait, _ = detourer(session, telecharger(source))
                date = None
            portrait.save(png, "PNG", optimize=True)
            credit = credit_commons(source) or {"auteur": None, "licence": None, "source": source}
            credit["date"] = date
            credit["texte"] = "Photo : " + " · ".join(x for x in [credit.get("auteur"), credit.get("licence"), "Wikimedia Commons" if "wikimedia" in source else g.get("photo_credit")] if x)
            if o.sortie:
                os.makedirs(o.sortie, exist_ok=True)
                open(os.path.join(o.sortie, f"{g['slug']}.png"), "wb").write(png.getvalue())
                json.dump(credit, open(os.path.join(o.sortie, f"{g['slug']}.json"), "w", encoding="utf-8"), ensure_ascii=False)
                print(f"local : {g['slug']} ({credit['texte']})")
            else:
                deposer(nom, png.getvalue(), "image/png")
                deposer(f"portraits/{g['slug']}.json", json.dumps(credit, ensure_ascii=False).encode(), "application/json")
                print(f"rangé : {g['slug']} ({credit['texte']})")
        except Exception as e:
            print(f"::warning::{g['slug']} : {e}")
        time.sleep(3)   # Wikimedia limite les téléchargements en rafale (429)


if __name__ == "__main__":
    sys.exit(main())
