import "dotenv/config";
import { runAssembleePipeline } from "../../workers/assemblee-pipeline.js";

// Point d'entrée autonome pour le fil d'actualité « média » (RSS officiels +
// médias reconnus → résumé DeepSeek → table content). Exécuté par le workflow
// GitHub Actions content-sync.yml, en remplacement de l'ancien worker interne.
runAssembleePipeline()
  .then(() => process.exit(0))
  .catch(error => { console.error(error); process.exit(1); });
