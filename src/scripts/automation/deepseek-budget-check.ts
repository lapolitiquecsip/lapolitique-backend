import "dotenv/config";
import { appendFileSync } from "node:fs";

// Garde-fou budget DeepSeek. Interroge le solde du compte AVANT les étapes IA d'un workflow.
// Écrit `has_budget=true|false` dans $GITHUB_OUTPUT pour que les étapes IA soient conditionnées
// (`if: steps.budget.outputs.has_budget == 'true'`). Ne fait JAMAIS échouer le job : un solde à 0
// est un événement de budget attendu (plafond ~10 $/mois), pas un bug — inutile d'alerter en rouge
// ni de bloquer les étapes GRATUITES en aval (notifications, tagging…).

const key = process.env.DEEPSEEK_API_KEY;
let hasBudget = false;
let detail = "";

try {
  if (!key) {
    detail = "DEEPSEEK_API_KEY absente";
  } else {
    const res = await fetch("https://api.deepseek.com/user/balance", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      // En cas d'indisponibilité de l'API solde, on n'empêche PAS le travail : on laisse tenter
      // (les appels IA échoueront proprement ou passeront selon le solde réel).
      hasBudget = true;
      detail = `API solde HTTP ${res.status} → on laisse tenter`;
    } else {
      const data = (await res.json()) as { is_available?: boolean; balance_infos?: { total_balance?: string }[] };
      hasBudget = data.is_available === true;
      const bal = data.balance_infos?.[0]?.total_balance ?? "?";
      detail = `is_available=${data.is_available} solde=${bal} USD`;
    }
  }
} catch (err: any) {
  // Erreur réseau sur la vérif elle-même → on laisse tenter plutôt que de tout sauter.
  hasBudget = true;
  detail = `vérif solde échouée (${err?.message}) → on laisse tenter`;
}

if (hasBudget) {
  console.log(`[BUDGET] ✅ Crédit DeepSeek disponible — étapes IA activées. (${detail})`);
} else {
  console.log("========================================================================");
  console.log("[BUDGET] ⚠️  SOLDE DEEPSEEK ÉPUISÉ — étapes IA IGNORÉES pour ce run.");
  console.log(`[BUDGET]     ${detail}`);
  console.log("[BUDGET]     Les étapes GRATUITES (imports, tagging, notifications) tournent quand même.");
  console.log("[BUDGET]     → Recharger : https://platform.deepseek.com/top_up pour réactiver l'IA.");
  console.log("========================================================================");
}

// Expose le flag à GitHub Actions (si présent). Sortie naturelle en 0 (pas de process.exit :
// évite une assertion libuv au teardown sur certaines plateformes).
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `has_budget=${hasBudget}\n`);
}
