/**
 * Télécharge un fichier open data, en réessayant : le serveur de l'Assemblée est instable (le même
 * fichier arrive en 9 s, en 2 min ou jamais, et la connexion est parfois coupée en route).
 * `signature` : les premiers octets attendus (« PK » pour un zip), pour ne pas prendre une page
 * d'erreur pour le fichier. Échoue après le dernier essai : mieux vaut une alarme qu'un relevé vide.
 */
export async function telecharger(url: string, { essais = 4, delaiMs = 180_000, signature }: { essais?: number; delaiMs?: number; signature?: string } = {}): Promise<Buffer> {
  let raison = "";
  for (let essai = 1; essai <= essais; essai++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(delaiMs) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const contenu = Buffer.from(await r.arrayBuffer());
      if (signature && contenu.subarray(0, signature.length).toString("latin1") !== signature) throw new Error("fichier inattendu");
      return contenu;
    } catch (e: any) {
      raison = e?.message || String(e);
      console.log(`::warning::${url} : essai ${essai}/${essais} en échec (${raison})`);
      if (essai < essais) await new Promise(fin => setTimeout(fin, essai * 30_000));
    }
  }
  throw new Error(`${url} : ${essais} essais en échec (${raison})`);
}
