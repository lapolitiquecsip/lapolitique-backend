
import Anthropic from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

async function test() {
  const models = ["claude-3-5-haiku-20241022", "claude-3-5-sonnet-20240620", "claude-3-5-sonnet-20240620", "claude-2.1"];
  
  for (const model of models) {
    try {
      console.log(`Testing model: ${model}...`);
      const response = await anthropic.messages.create({
        model: model,
        max_tokens: 10,
        messages: [{ role: "user", content: "Hi" }]
      });
      console.log(`✅ ${model} works!`);
      return;
    } catch (e: any) {
      console.log(`❌ ${model} failed: ${e.message}`);
    }
  }
}

test();
