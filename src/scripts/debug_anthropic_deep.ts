
import Anthropic from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

async function debugAnthropic() {
  const key = process.env.ANTHROPIC_API_KEY || '';
  console.log('--- ANTHROPIC DEBUG ---');
  console.log(`API Key prefix: ${key.substring(0, 14)}...`);
  console.log(`API Key length: ${key.length}`);

  const anthropic = new Anthropic({
    apiKey: key,
  });

  // Modèles à tester (identifiants officiels)
  const models = [
    "claude-3-opus-20240229"
  ];

  for (const model of models) {
    try {
      console.log(`\nTesting model: ${model}`);
      const response = await anthropic.messages.create({
        model: model,
        max_tokens: 5,
        messages: [{ role: "user", content: "Hi" }]
      });
      console.log(`✅ Success with ${model}!`);
      console.log(`Response ID: ${response.id}`);
      return; // On s'arrête si un modèle marche
    } catch (err: any) {
      console.log(`❌ Failed for ${model}`);
      console.log(`Status: ${err.status}`);
      console.log(`Type: ${err.type}`);
      console.log(`Message: ${err.message}`);
      if (err.error) {
        console.log('Detailed Error:', JSON.stringify(err.error, null, 2));
      }
    }
  }
}

debugAnthropic().catch(console.error);
