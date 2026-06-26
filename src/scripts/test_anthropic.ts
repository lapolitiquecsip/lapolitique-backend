import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { resilientDeepSeek } from '../lib/deepseek-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

async function test() {
  const models = ['deepseek-v4-flash', 'deepseek-v4-pro'];
  
  for (const model of models) {
    try {
      console.log(`Testing model: ${model}...`);
      const response = await resilientDeepSeek.createMessage({
        model: model,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }]
      });
      console.log(`✅ ${model} works! Response: ${response.content[0]?.text}`);
    } catch (e: any) {
      console.log(`❌ ${model} failed: ${e.message}`);
    }
  }
}

test();
