
import Anthropic from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';
dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

async function test() {
  const models = [
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
    'claude-3-sonnet-20240229',
    'claude-3-haiku-20240307',
    'claude-2.1',
    'claude-instant-1.2'
  ];

  for (const model of models) {
    try {
      console.log(`Testing model: ${model}...`);
      const response = await anthropic.messages.create({
        model: model,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }]
      });
      console.log(`✅ Success with ${model}:`, response.content[0]);
      return;
    } catch (err: any) {
      console.error(`❌ Error ${model}:`, err.status, err.message);
    }
  }
}
test();
