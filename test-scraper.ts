import * as cheerio from 'cheerio';

async function main() {
  const response = await fetch('https://petitions.assemblee-nationale.fr/initiatives?order=most_voted', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
      }
  });
  const html = await response.text();
  const $ = cheerio.load(html);
  
  const card = $('.card--initiative').first();
  const title = card.find('.card__title').text().trim();
  const sigText = card.find('.progress__bar__number').text().trim();
  const thresholdText = card.find('.progress__bar__total').text().trim();
  
  console.log("Title:", title);
  console.log("Sig text:", sigText);
  console.log("Threshold text:", thresholdText);
}
main();
