import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

/**
 * Transcription d'une vidéo YouTube publique : sous-titres (manuels ou automatiques) via
 * yt-dlp ; secours : Gemini lit la vidéo elle-même (clé gratuite LLM_FREE_API_KEY).
 */

export function dureeEtSousTitres(url: string): { duree: number; texte: string } {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "prog-"));
  const ytdlp = (args: string[]) => execFileSync(process.env.PYTHON || "python", ["-m", "yt_dlp", ...args], { stdio: ["ignore", "pipe", "pipe"], timeout: 180000 }).toString();
  let duree = 0;
  try { duree = Number(ytdlp(["--skip-download", "--print", "duration", url]).trim().split("\n").pop()) || 0; } catch { /* inconnue */ }
  try {
    ytdlp(["--skip-download", "--write-auto-subs", "--write-subs", "--sub-langs", "fr.*,fr", "--sub-format", "json3", "-o", path.join(dossier, "v.%(ext)s"), url]);
    const f = fs.readdirSync(dossier).find(x => x.endsWith(".json3"));
    if (!f) return { duree, texte: "" };
    const j = JSON.parse(fs.readFileSync(path.join(dossier, f), "utf8"));
    const texte = (j.events || []).filter((e: any) => e.segs).map((e: any) => e.segs.map((s: any) => s.utf8 || "").join("")).join(" ");
    return { duree, texte: texte.replace(/\s+/g, " ").trim() };
  } catch { return { duree, texte: "" }; }
  finally { fs.rmSync(dossier, { recursive: true, force: true }); }
}

/** Secours : Gemini lit la vidéo YouTube et en donne la transcription. */
export async function transcrireGemini(url: string): Promise<string> {
  const cle = process.env.LLM_FREE_API_KEY;
  if (!cle) return "";
  for (const modele of ["gemini-flash-latest", "gemini-flash-lite-latest"]) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modele}:generateContent?key=${cle}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(600000),
        body: JSON.stringify({
          contents: [{ parts: [{ file_data: { file_uri: url } }, { text: "Transcris intégralement et fidèlement, en français, tout ce qui est dit dans cette vidéo. Texte brut, sans commentaire ni résumé." }] }],
          generationConfig: { mediaResolution: "MEDIA_RESOLUTION_LOW", maxOutputTokens: 60000 },
        }),
      });
      if (!r.ok) continue;
      const j: any = await r.json();
      const t = (j.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("").trim();
      if (t.length > 1000) return t;
    } catch { /* modèle suivant */ }
  }
  return "";
}

