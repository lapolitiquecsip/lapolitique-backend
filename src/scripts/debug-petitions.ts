import * as cheerio from 'cheerio';

async function debug() {
  const url = 'https://petitions.assemblee-nationale.fr/initiatives?order=most_voted';
  console.log(`Fetching ${url}...`);
  
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
    }
  });

  const html = await response.text();
  const $ = cheerio.load(html);

  const cards = $('.card--initiative, .card.card--initiative, article.card--initiative, .card');
  console.log(`Found ${cards.length} cards.`);

  if (cards.length > 0) {
    const firstCard = cards.first();
    console.log('\n--- FIRST CARD ATTRIBUTES ---');
    console.log(firstCard.attr());
    
    console.log('\n--- CARD INNER STRUCTURE (Classes) ---');
    firstCard.find('*').each((_, el) => {
      const cls = $(el).attr('class');
      if (cls) console.log(`  <${el.tagName}> class="${cls}" text="${$(el).text().trim().substring(0, 30)}"`);
    });

    console.log('\n--- SEARCHING FOR SIGNATURES ---');
    const text = firstCard.text();
    const numbers = text.match(/\d+[\s\d]*/g);
    console.log('Numbers found in text:', numbers);
    
    console.log('Testing .card__support__number:', firstCard.find('.card__support__number').text().trim());
  }
}

debug().catch(console.error);
