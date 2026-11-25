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
import argparse, io, json, os, re, sys, time, urllib.parse, urllib.request
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
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()


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
    """U²-Net : masque 0-1 de la personne, à la taille de l'image."""
    petit = image.convert("RGB").resize((320, 320), Image.LANCZOS)
    x = np.asarray(petit, dtype=np.float32)
    x = x / max(x.max(), 1e-6)
    x = (x - np.array([0.485, 0.456, 0.406])) / np.array([0.229, 0.224, 0.225])
    x = x.transpose(2, 0, 1)[None].astype(np.float32)
    sortie = session.run(None, {session.get_inputs()[0].name: x})[0][0, 0]
    sortie = (sortie - sortie.min()) / max(sortie.max() - sortie.min(), 1e-6)
    m = Image.fromarray((sortie * 255).astype(np.uint8)).resize(image.size, Image.LANCZOS)
    # Bord net mais pas crénelé : léger lissage, puis seuil doux.
    m = m.filter(ImageFilter.GaussianBlur(1))
    return m.point(lambda v: 0 if v < 40 else 255 if v > 200 else int((v - 40) * 255 / 160))


def detourer(session, contenu):
    image = Image.open(io.BytesIO(contenu))
    image = ImageOps.exif_transpose(image).convert("RGB")
    if max(image.size) > 1600:
        image.thumbnail((1600, 1600), Image.LANCZOS)
    m = masque(session, image)
    # Une personne coupée par le bord de la photo laisse un trait droit : on l'estompe sur 7 %.
    a = np.asarray(m, dtype=np.float32)
    h, w = a.shape
    for cote, bande in (("haut", a[0, :]), ("gauche", a[:, 0]), ("droite", a[:, -1])):
        if (bande > 128).mean() > 0.04:
            n = max(8, int(0.07 * (h if cote == "haut" else w)))
            rampe = np.linspace(0, 1, n, dtype=np.float32)
            if cote == "haut":
                a[:n, :] *= rampe[:, None]
            elif cote == "gauche":
                a[:, :n] *= rampe[None, :]
            else:
                a[:, -n:] *= rampe[::-1][None, :]
    m = Image.fromarray(a.clip(0, 255).astype(np.uint8))
    gris = ImageOps.autocontrast(ImageOps.grayscale(image), cutoff=2)
    # Noir et blanc « presse », comme les visuels faits main : contrasté et net.
    gris = gris.point(lambda v: int(255 * ((v / 255) ** 1.18)))
    gris = gris.filter(ImageFilter.UnsharpMask(radius=2, percent=80, threshold=2))
    rgba = Image.merge("RGBA", (gris, gris, gris, m))
    boite = m.point(lambda v: 255 if v > 25 else 0).getbbox()
    if not boite:
        return rgba
    g, h, d, b = boite
    # Cadrage serré « tête et épaules », comme les visuels faits main (proportion 2:3) : centré sur la
    # tête (repérée en haut du masque), les épaules coupées sur les côtés, bords estompés.
    A = np.asarray(m, dtype=np.float32)
    haut = A[h + int(0.05 * (b - h)): h + int(0.2 * (b - h)) + 1, :]
    xs = np.where(haut.max(axis=0) > 128)[0]
    if len(xs):
        tete = max(xs.max() - xs.min(), 40)
        cx = (xs.max() + xs.min()) / 2
        hc = min(b - h, int(tete * 2.3))
        wc = int(hc / 1.45)
        g2, d2 = int(max(0, cx - wc / 2)), int(min(A.shape[1], cx + wc / 2))
        b2 = h + hc
        sortie = rgba.crop((g2, h, d2, b2))
        alpha = np.asarray(sortie.getchannel("A"), dtype=np.float32)
        n = max(8, int(0.08 * alpha.shape[1]))
        rampe = np.linspace(0, 1, n, dtype=np.float32)
        if g2 > g: alpha[:, :n] *= rampe[None, :]
        if d2 < d: alpha[:, -n:] *= rampe[::-1][None, :]
        sortie.putalpha(Image.fromarray(alpha.astype(np.uint8)))
        return sortie
    return rgba.crop((g, h, d, b))


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--modele", required=True)
    a.add_argument("--slug")
    a.add_argument("--sortie")
    a.add_argument("--refaire", action="store_true")
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
            source = g["photo_url"]
            try:
                source = original_non_recadre(source) or source
            except Exception:
                pass
            detourer(session, telecharger(source)).save(png, "PNG", optimize=True)
            credit = credit_commons(g["photo_url"]) or {"auteur": None, "licence": None, "source": g["photo_url"]}
            credit["texte"] = "Photo : " + " · ".join(x for x in [credit.get("auteur"), credit.get("licence"), "Wikimedia Commons" if "wikimedia" in g["photo_url"] else g.get("photo_credit")] if x)
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
