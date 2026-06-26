
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { resilientDeepSeek } from '../lib/deepseek-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

async function debugDeepSeek() {
  const key = process.env.DEEPSEEK_API_KEY || '';
  console.log('--- DEEPSEEK DEBUG ---');
  console.log(`API Key prefix: ${key.substring(0, 10)}...`);
  console.log(`API Key length: ${key.length}`);

  const models = ['deepseek-v4-flash', 'deepseek-v4-pro'];

  for (const model of models) {
    try {
      console.log(`\nTesting model: ${model}`);
      const response = await resilientDeepSeek.createMessage({
        model: model,
        max_tokens: 5,
        messages: [{ role: 'user', content: 'Hi' }]
      });
      console.log(`✅ Success with ${model}!`);
      console.log(`Response: ${response.content[0]?.text}`);
      return; // Stop if one model works
    } catch (err: any) {
      console.log(`❌ Failed for ${model}`);
      console.log(`Status: ${err.status}`);
      console.log(`Message: ${err.message}`);
    }
  }
}

debugDeepSeek().catch(console.error);
