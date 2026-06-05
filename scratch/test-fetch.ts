import * as cheerio from 'cheerio';

async function test() {
  const url = 'https://petitions.assemblee-nationale.fr/initiatives?order=most_voted';
  console.log(`Fetching ${url}...`);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
      }
    });
    console.log(`Status: ${response.status} ${response.statusText}`);
    const html = await response.text();
    const $ = cheerio.load(html);
    const cards = $('.card--initiative');
    console.log(`Found ${cards.length} cards with class '.card--initiative'`);
    
    cards.each((i, card) => {
      const title = $(card).find('.card__title').text().trim();
      console.log(`Card ${i + 1}: ${title}`);
    });
  } catch (error: any) {
    console.error('Error:', error.message);
  }
}

test();
