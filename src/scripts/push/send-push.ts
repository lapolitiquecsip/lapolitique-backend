import "dotenv/config";
import { createSign } from "crypto";
import { supabase } from "../../config/supabase.js";

// Envoi de notifications push via Firebase Cloud Messaging (HTTP v1). Cible tous les appareils
// enregistrés, ou seulement les premium avec --premium. Authentification par compte de service
// Firebase (JSON), sans dépendance externe : on signe un JWT et on l'échange contre un jeton.
//
// Env requis : FCM_SERVICE_ACCOUNT_JSON = contenu JSON du compte de service Firebase.
// Usage : npm run push:send -- --title "Titre" --body "Message" [--premium] [--url /lois]
function arg(name: string, def = ""): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : def;
}
const PREMIUM_ONLY = process.argv.includes("--premium");

function loadServiceAccount(): { client_email: string; private_key: string; project_id: string } {
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FCM_SERVICE_ACCOUNT_JSON manquant (JSON du compte de service Firebase).");
  return JSON.parse(raw);
}

// JWT signé RS256 → jeton d'accès OAuth pour l'API FCM.
async function accessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  };
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64(header)}.${b64(claim)}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
  const jwt = `${unsigned}.${signature}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const json: any = await res.json();
  if (!json.access_token) throw new Error("OAuth FCM échoué : " + JSON.stringify(json));
  return json.access_token;
}

async function main() {
  const title = arg("title"); const body = arg("body"); const url = arg("url", "/");
  if (!title || !body) { console.error('Usage: npm run push:send -- --title "…" --body "…" [--premium] [--url /lois]'); process.exit(1); }

  const sa = loadServiceAccount();
  const token = await accessToken(sa);

  let q = supabase.from("device_tokens").select("token");
  if (PREMIUM_ONLY) q = q.eq("premium", true);
  const { data, error } = await q;
  if (error) throw error;
  const tokens = (data || []).map((r: any) => r.token);
  console.log(`> ${tokens.length} appareils ciblés${PREMIUM_ONLY ? " (premium)" : ""}.`);

  const endpoint = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  let ok = 0, dead: string[] = [];
  for (const t of tokens) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { token: t, notification: { title, body }, data: { url }, webpush: {}, android: { priority: "high" } } }),
    });
    if (res.ok) ok++;
    else if (res.status === 404 || res.status === 400) dead.push(t);   // jeton invalide/expiré
  }
  console.log(`> ${ok} envoyés, ${dead.length} jetons morts.`);
  if (dead.length) { await supabase.from("device_tokens").delete().in("token", dead); console.log("  jetons morts supprimés."); }
  console.log("--- TERMINE. ---");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
