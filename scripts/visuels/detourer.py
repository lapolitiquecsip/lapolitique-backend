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
import argparse, io, json, os, re, sys, time, unicodedata, urllib.error, urllib.parse, urllib.request
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

try:  # détecteur de visages YuNet (OpenCV, licence MIT) : facultatif, active --visages
    import cv2
except ImportError:
    cv2 = None
VISAGES = None

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


def rest(chemin, methode="GET", corps=None):
    r = urllib.request.Request(f"{URL}/rest/v1/{chemin}", method=methode, data=json.dumps(corps).encode() if corps is not None else None,
                               headers={"apikey": CLE, "Authorization": f"Bearer {CLE}", "Content-Type": "application/json", "Prefer": "return=minimal"})
    reponse = urllib.request.urlopen(r, timeout=30).read()
    return json.loads(reponse) if reponse else None


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


def visages(image):
    """Visages trouvés par YuNet, du plus grand au plus petit : [(x, y, largeur, hauteur, score)]."""
    if VISAGES is None:
        return None
    # YuNet rate les très grands visages (gros plans) : on cherche sur une copie de 640 px au plus.
    r = min(1.0, 640 / max(image.size))
    petit = image.resize((max(1, int(image.width * r)), max(1, int(image.height * r))), Image.LANCZOS) if r < 1 else image
    arr = cv2.cvtColor(np.asarray(petit), cv2.COLOR_RGB2BGR)
    VISAGES.setInputSize((arr.shape[1], arr.shape[0]))
    _, f = VISAGES.detect(arr)
    if f is None:
        return []
    return sorted([tuple(float(v) / r for v in (x[0], x[1], x[2], x[3])) + (float(x[14]),) for x in f if x[14] >= 0.75], key=lambda v: -v[2] * v[3])


def detourer(session, contenu, exiger_visage=False):
    """Renvoie (portrait RGBA noir et blanc, qualité) ; qualité dit si la personne touche un bord
    de la photo (coupée), et quelle part de l'image elle occupe. Avec exiger_visage : refuse les
    photos sans visage net, avec plusieurs personnes de même taille ou un visage trop petit, et ne
    garde au détourage que la personne du visage principal (pas ses voisins)."""
    image = Image.open(io.BytesIO(contenu))
    image = ImageOps.exif_transpose(image).convert("RGB")
    if max(image.size) > 2000:
        image.thumbnail((2000, 2000), Image.LANCZOS)
    principal = None
    if exiger_visage and VISAGES is not None:
        v = visages(image)
        if not v:
            raise ValueError("aucun visage net")
        principal = v[0]
        if len(v) > 1 and v[1][2] > 0.62 * principal[2]:
            raise ValueError("plusieurs personnes au premier plan")
        if principal[2] < 140:
            raise ValueError("visage trop petit")
    m = masque(session, image)
    A = np.asarray(m, dtype=np.float32)
    if principal is not None and cv2 is not None:
        n, lab = cv2.connectedComponents((A > 128).astype(np.uint8))
        cy, cx = int(principal[1] + principal[3] / 2), int(principal[0] + principal[2] / 2)
        k = lab[min(cy, lab.shape[0] - 1), min(cx, lab.shape[1] - 1)]
        if k == 0:
            raise ValueError("le visage n'est pas dans le détourage")
        garde = cv2.dilate((lab == k).astype(np.uint8), np.ones((5, 5), np.uint8))
        A = A * garde
        m = Image.fromarray(A.astype(np.uint8))
    qualite = {
        "touche_haut": float((A[0, :] > 128).mean()), "touche_gauche": float((A[:, 0] > 128).mean()),
        "touche_droite": float((A[:, -1] > 128).mean()), "aire": float((A > 128).mean()),
        "largeur": image.size[0], "hauteur": image.size[1], "visage": int(principal[2]) if principal else None,
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
    if principal:
        tete = principal[2] * 1.15
    else:
        haut = A[h + int(0.05 * (b - h)): h + int(0.2 * (b - h)) + 1, :]
        xs = np.where(haut.max(axis=0) > 128)[0]
        tete = max(xs.max() - xs.min(), 40) if len(xs) else (d - g) / 2.5
    qualite["tete"] = int(tete)
    portrait = rgba.crop((g, h, d, min(b, h + int(tete * 2.6))))
    # Bords du portrait FINAL : g/h/d ne coïncident avec le bord de la photo que si la personne y est coupée.
    al = np.asarray(portrait.getchannel("A"))
    haut_coupe = h == 0 and (al[0, :] > 128).mean() > 0.01
    gauche_coupe = g == 0 and (al[: int(al.shape[0] * 0.75), 0] > 128).mean() > 0.03
    qualite["coupee"] = bool(haut_coupe or gauche_coupe)
    return portrait, qualite


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
    # Le nom de famille doit figurer dans le titre du fichier : une catégorie contient aussi des
    # manifestations, des affiches, des proches… (25/11 : « Philippe » et « Le Pen » mal reconnus).
    plat = lambda t: unicodedata.normalize("NFD", t).encode("ascii", "ignore").decode().lower().replace("_", " ").replace("-", " ")
    famille = plat(" ".join(w for w in nom.split(" ")[1:] if w))
    titres = [t for t in titres if re.search(r"\.(jpe?g|png|webp|tiff?)$", t, re.I) and famille in plat(t)]
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


def infos_commons(url):
    """(date de prise de vue, url 1800 px, page) d'un fichier Commons, ou None."""
    m = re.search(r"/commons/(?:thumb/)?[0-9a-f]/[0-9a-f]{2}/([^/?]+)", url or "")
    if not m:
        return None
    d = _api({"action": "query", "titles": f"File:{urllib.parse.unquote(m.group(1))}", "prop": "imageinfo", "iiprop": "url|extmetadata", "iiurlwidth": 1800})
    page = next(iter(d.get("query", {}).get("pages", {}).values()), {})
    info = (page.get("imageinfo") or [{}])[0]
    meta = info.get("extmetadata", {})
    brut = " ".join(str(meta.get(k, {}).get("value") or "") for k in ("DateTimeOriginal", "DateTime")) + " " + page.get("title", "")
    dm = DATE.search(brut)
    return (f"{dm.group(1)}-{dm.group(2)}-{dm.group(3)}" if dm else "0000-00-00", info.get("thumburl") or info.get("url") or url, info.get("descriptionurl"))


def propositions(session, nom, combien=3, essais=30, fiche=None):
    """Les `combien` photos les plus récentes et exploitables d'une personne : un visage principal net
    et assez grand, la personne entière (ni coupée en haut ni sur les côtés). Plus récentes d'abord ;
    sans photo récente, les plus récentes disponibles. [(portrait, url, page, date)]"""
    retenues, secours = [], []
    candidates = photos_recentes(nom, essais)
    # La photo de la fiche du site (et son original non recadré) concourt aussi, à sa date.
    for u in [fiche, original_non_recadre(fiche) if fiche else None]:
        try:
            i = infos_commons(u) if u else None
            if i and all(i[1] != c[1] for c in candidates):
                candidates.append(i)
        except Exception:
            pass
    candidates.sort(reverse=True)
    for date, url, page in candidates:
        try:
            portrait, q = detourer(session, telecharger(url), exiger_visage=True)
        except Exception as e:
            print(f"  écartée {date} : {e}")
            time.sleep(2)
            continue
        time.sleep(2)
        if q.get("coupee"):
            print(f"  en réserve {date} : personne coupée en haut ou à gauche")
            secours.append((portrait, url, page, date + " (coupée)"))
            continue
        retenues.append((portrait, url, page, date))
        if len(retenues) >= combien:
            break
    # Pas assez de photos entières : les portraits coupés passent en dernier, signalés comme tels.
    return (retenues + secours)[:combien]


FOND_PROGRAMME, ENCRE = (241, 188, 205), (74, 21, 49)


def apercu(portrait, numero, date):
    """Vignette pour WhatsApp : le portrait sur le rose de la charte, avec son numéro et sa date."""
    l, h = 720, 900
    fond = Image.new("RGB", (l, h), FOND_PROGRAMME)
    p = portrait.copy()
    p.thumbnail((l - 40, h - 150), Image.LANCZOS)
    fond.paste(p, ((l - p.width) // 2 + 20, h - p.height), p)
    d = ImageDraw.Draw(fond)
    try:
        police = ImageFont.truetype("arialbd.ttf", 96)
        petite = ImageFont.truetype("arialbd.ttf", 34)
    except OSError:
        try:
            police = ImageFont.truetype("DejaVuSans-Bold.ttf", 96)
            petite = ImageFont.truetype("DejaVuSans-Bold.ttf", 34)
        except OSError:
            police = petite = ImageFont.load_default()
    d.rectangle((30, 30, 150, 150), fill=ENCRE)
    d.text((90, 90), str(numero), font=police, fill="white", anchor="mm")
    d.text((175, 90), f"photo du {date}" if date else "photo de la fiche", font=petite, fill=ENCRE, anchor="lm")
    tampon = io.BytesIO()
    fond.save(tampon, "JPEG", quality=88)
    return tampon.getvalue()


def demande(slug, nom, options):
    """Dépose la demande « choisis la photo » dans le QG (WhatsApp)."""
    lignes = [f"{i + 1} : {o['date'] or 'date inconnue'} · {o['credit']}" for i, o in enumerate(options)]
    corps = {
        "agent": "tache:back:publications-reseaux.yml", "equipe": "marketing", "action": "choisir_portrait",
        "cle": f"portrait-{slug}-{time.strftime('%Y%m%d')}", "risque": "faible",
        "titre": f"Portrait de {nom} : choisis la photo",
        "resume": "Rose a détouré les photos récentes libres de droits les plus nettes. ✅ = la n° 1 · ✏️ puis « 2 » ou « 3 » pour une autre · ❌ = aucune ne va.",
        "apercu": {"image": options[0]["apercu"], "images": [o["apercu"] for o in options], "texte": "\n".join(lignes), "slug": slug, "options": options},
    }
    r = urllib.request.Request(f"{URL}/rest/v1/qg_demandes", data=json.dumps(corps).encode(), method="POST",
                               headers={"apikey": CLE, "Authorization": f"Bearer {CLE}", "Content-Type": "application/json", "Prefer": "return=minimal"})
    try:
        urllib.request.urlopen(r, timeout=30)
        return True
    except urllib.error.HTTPError as e:
        print(f"::warning::demande {slug} : {e.code} {e.read().decode()[:150]}")
        return False


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--modele", required=True)
    a.add_argument("--slug")
    a.add_argument("--sortie")
    a.add_argument("--refaire", action="store_true")
    a.add_argument("--fiche", action="store_true", help="prendre la photo de la fiche du site, pas la plus récente de Commons")
    a.add_argument("--visages", help="modèle YuNet (face_detection_yunet_2023mar.onnx) : écarte foules et photos sans visage net")
    a.add_argument("--proposer", action="store_true", help="3 photos par candidat, envoyées sur WhatsApp pour qu'Hippolyte choisisse")
    a.add_argument("--programmes", action="store_true", help="seulement les candidats qui ont un programme en base")
    a.add_argument("--depuis", help="détourer CETTE image (URL ou fichier, ex. envoyée par Hippolyte sur WhatsApp) pour --slug")
    a.add_argument("--credit", help="crédit photo de l'image --depuis (ex. « Photo : X »)")
    a.add_argument("--recus", action="store_true", help="détourer les photos envoyées par Hippolyte sur WhatsApp (demandes choisir_portrait)")
    a.add_argument("--manquants", action="store_true", help="avec --proposer : seulement les candidats sans portrait ni demande ouverte")
    o = a.parse_args()
    session = ort.InferenceSession(o.modele, providers=["CPUExecutionProvider"])
    global VISAGES
    if o.visages:
        if cv2 is None:
            sys.exit("--visages demande opencv-python-headless")
        VISAGES = cv2.FaceDetectorYN.create(o.visages, "", (320, 320), 0.75)
    if o.recus:
        # Photos envoyées sur WhatsApp (rose-portraits.ts les a mises de côté, statut « annulee »).
        for d in rest("qg_demandes?select=id,apercu,resultat,agent,equipe,societe,titre&action=eq.choisir_portrait&statut=eq.annulee&resultat->>a_detourer=not.is.null&resultat->>fait=is.null"):
            slug, image = (d.get("apercu") or {}).get("slug"), d["resultat"]["a_detourer"]
            try:
                portrait, q = detourer(session, telecharger(image), exiger_visage=VISAGES is not None)
                png = io.BytesIO()
                portrait.save(png, "PNG", optimize=True)
                url = deposer(f"portraits/{slug}.png", png.getvalue(), "image/png")
                deposer(f"portraits/{slug}.json", json.dumps({"texte": None, "source": image, "fourni": True}, ensure_ascii=False).encode(), "application/json")
                rest(f"qg_demandes?id=eq.{d['id']}", "PATCH", {"statut": "executee", "resultat": {**d["resultat"], "fait": True, "portrait": url}})
                rest("qg_activite", "POST", {"agent": d["agent"], "equipe": d["equipe"], "societe": d["societe"], "genre": "succes", "demande": d["id"], "lien": url,
                                             "message": f"Portrait détouré depuis ta photo : {slug}" + (" (coupé en haut ou à gauche)" if q.get("coupee") else "")})
                print(f"portrait de {slug} détouré depuis la photo envoyée")
            except Exception as e:
                rest(f"qg_demandes?id=eq.{d['id']}", "PATCH", {"resultat": {**d["resultat"], "fait": True, "erreur": str(e)[:200]}})
                rest("qg_activite", "POST", {"agent": d["agent"], "equipe": d["equipe"], "societe": d["societe"], "genre": "attention", "demande": d["id"], "lien": image,
                                             "message": f"Je n'ai pas pu détourer ta photo pour {slug} : {str(e)[:120]}. Envoie-en une autre (visage net, seul au premier plan)."})
                print(f"::warning::{slug} : {e}")
        return
    if o.depuis:
        if not o.slug:
            sys.exit("--depuis demande --slug")
        contenu = telecharger(o.depuis) if o.depuis.startswith("http") else open(o.depuis, "rb").read()
        portrait, q = detourer(session, contenu, exiger_visage=VISAGES is not None)
        png = io.BytesIO()
        portrait.save(png, "PNG", optimize=True)
        credit = {"texte": o.credit, "source": o.depuis if o.depuis.startswith("http") else None, "fourni": True}
        if o.sortie:
            os.makedirs(o.sortie, exist_ok=True)
            open(os.path.join(o.sortie, f"{o.slug}.png"), "wb").write(png.getvalue())
        else:
            deposer(f"portraits/{o.slug}.png", png.getvalue(), "image/png")
            deposer(f"portraits/{o.slug}.json", json.dumps(credit, ensure_ascii=False).encode(), "application/json")
        print(f"portrait de {o.slug} détouré depuis l'image fournie{' (coupée en haut ou à gauche)' if q.get('coupee') else ''}")
        return
    filtre = f"&slug=eq.{o.slug}" if o.slug else "&status=eq.declared"
    gens = rest(f"presidential_candidates?select=id,slug,full_name,photo_url,photo_credit&photo_url=not.is.null{filtre}")
    if o.programmes:
        avec = set()
        for g in gens:
            if rest(f"candidate_proposals?select=id&candidate_id=eq.{g['id']}&limit=1"):
                avec.add(g["id"])
        gens = [g for g in gens if g["id"] in avec]
    if o.proposer and o.manquants:
        faits = {f["name"].removesuffix(".png") for f in json.load(urllib.request.urlopen(urllib.request.Request(
            f"{URL}/storage/v1/object/list/publications", data=json.dumps({"prefix": "portraits/", "limit": 1000}).encode(), method="POST",
            headers={"apikey": CLE, "Authorization": f"Bearer {CLE}", "Content-Type": "application/json"}), timeout=30))}
        ouvertes = {(d.get("apercu") or {}).get("slug") for d in rest("qg_demandes?select=apercu&action=eq.choisir_portrait&statut=in.(a_valider,a_modifier,validee)")}
        gens = [g for g in gens if g["slug"] not in faits and g["slug"] not in ouvertes]
    if o.proposer:
        for g in gens:
            print(f"{g['full_name']} :")
            options = []
            for i, (portrait, source, page, date) in enumerate(propositions(session, g["full_name"], fiche=g["photo_url"])):
                credit = credit_commons(source) or {"auteur": None, "licence": None, "source": page}
                texte = " · ".join(x for x in [credit.get("auteur"), credit.get("licence")] if x) or "Wikimedia Commons"
                png = io.BytesIO()
                portrait.save(png, "PNG", optimize=True)
                base = f"portraits/propositions/{g['slug']}/{i + 1}"
                if o.sortie:
                    os.makedirs(o.sortie, exist_ok=True)
                    open(os.path.join(o.sortie, f"{g['slug']}-{i + 1}.jpg"), "wb").write(apercu(portrait, i + 1, date))
                    options.append({"date": date, "credit": texte})
                    continue
                options.append({
                    "png": deposer(f"{base}.png", png.getvalue(), "image/png"),
                    "apercu": deposer(f"{base}.jpg", apercu(portrait, i + 1, date), "image/jpeg"),
                    "date": date, "credit": texte, "page": page,
                    "credit_json": {**credit, "date": date, "texte": f"Photo : {texte} · Wikimedia Commons"},
                })
            print(f"  -> {len(options)} photo(s) proposée(s)")
            if options and not o.sortie:
                demande(g["slug"], g["full_name"], options)
            time.sleep(3)
        return
    for g in gens:
        nom = f"portraits/{g['slug']}.png"
        if not o.refaire and not o.sortie and existe(nom):
            print(f"déjà fait : {g['slug']}")
            continue
        try:
            png = io.BytesIO()
            choix = propositions(session, g["full_name"], 1, fiche=g["photo_url"]) if not o.fiche else []
            if choix:
                portrait, source, page, date = choix[0]
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
