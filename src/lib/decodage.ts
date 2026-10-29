/**
 * Texte d'une réponse HTTP décodé selon SON encodage. response.text() lit toujours de l'UTF-8 :
 * les flux et pages du Sénat, en iso-8859-15, perdaient tous leurs accents (« D�lits routiers »,
 * « d�pos� »), irrécupérables une fois enregistrés (415 articles abîmés au 30/10/2026).
 * Ordre : en-tête Content-Type, prologue XML, balise <meta charset>, sinon UTF-8.
 */
export async function texteDecode(res: Response): Promise<string> {
  const octets = Buffer.from(await res.arrayBuffer());
  const debut = octets.subarray(0, 2048).toString("latin1");
  const encodage = (/charset=["']?([\w-]+)/i.exec(res.headers.get("content-type") || "")?.[1]
    || /^<\?xml[^>]*encoding=["']([\w-]+)["']/i.exec(debut)?.[1]
    || /<meta[^>]+charset=["']?([\w-]+)/i.exec(debut)?.[1]
    || "utf-8").toLowerCase();
  try { return new TextDecoder(encodage).decode(octets); } catch { return octets.toString("utf-8"); }
}
