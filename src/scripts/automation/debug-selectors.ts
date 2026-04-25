import * as cheerio from 'cheerio';

async function run() {
  const r = await fetch('https://www2.assemblee-nationale.fr/documents/liste?type=propositions-loi');
  const html = await r.text();
  const $ = cheerio.load(html);
  
  $('ul.liens-liste li').slice(0, 3).each((i, el) => {
    console.log(`\n--- ITEM ${i} ---`);
    console.log('Title:', $(el).find('h3').text().trim());
    console.log('Description:', $(el).find('p').text().trim());
  });
}

run().catch(console.error);
