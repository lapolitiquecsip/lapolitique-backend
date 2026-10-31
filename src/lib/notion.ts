/** Accès minimal à l'API Notion : la clé vient de NOTION_API_KEY, jamais du dépôt. */
const VERSION = "2022-06-28";

export const notionActif = () => Boolean(process.env.NOTION_API_KEY);

export async function notion(chemin: string, corps?: unknown, methode = corps ? "POST" : "GET"): Promise<any> {
  const r = await fetch(`https://api.notion.com/v1/${chemin}`, {
    method: methode,
    headers: { Authorization: `Bearer ${process.env.NOTION_API_KEY}`, "Notion-Version": VERSION, "Content-Type": "application/json" },
    body: corps ? JSON.stringify(corps) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`Notion ${r.status} sur ${chemin} : ${(await r.text()).slice(0, 400)}`);
  return r.json();
}

/** Notion limite chaque segment de texte à 2 000 caractères. */
export const texteRiche = (t: string) =>
  (t.match(/[\s\S]{1,2000}/g) ?? []).slice(0, 50).map(content => ({ type: "text", text: { content } }));

export const lireTexte = (p: any) => (p?.rich_text ?? p?.title ?? []).map((x: any) => x.plain_text).join("");
