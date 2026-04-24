import { chromium } from 'playwright';

async function debug() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://petitions.assemblee-nationale.fr/initiatives?order=most_voted', { waitUntil: 'networkidle' });
  await page.waitForSelector('.card');
  
  const cardHtml = await page.evaluate(() => {
    const card = document.querySelector('.card');
    return card ? card.innerHTML : 'No card found';
  });
  
  console.log('--- CARD HTML ---');
  console.log(cardHtml);
  console.log('--- END CARD HTML ---');
  
  await browser.close();
}

debug().catch(console.error);
