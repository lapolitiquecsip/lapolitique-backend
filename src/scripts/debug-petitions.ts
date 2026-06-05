import * as cheerio from 'cheerio';

async function debug() {
  const url = 'https://petitions.assemblee-nationale.fr/initiatives?order=most_voted';
  console.log(`Fetching ${url}...`);
  
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    }
  });

  const html = await response.text();
  const $ = cheerio.load(html);

  const cards = $('.card--initiative');
  console.log(`Found ${cards.length} cards.`);

  if (cards.length > 0) {
    const firstCard = cards.first();
    console.log('\n--- FIRST CARD HTML ---');
    console.log(firstCard.html());
  }
}

debug().catch(console.error);
