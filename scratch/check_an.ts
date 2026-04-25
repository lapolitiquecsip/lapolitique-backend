
import axios from 'axios';
import * as cheerio from 'cheerio';

async function run() {
  try {
    const { data } = await axios.get('https://www2.assemblee-nationale.fr/documents/liste?type=projets-loi');
    const $ = cheerio.load(data);
    $('.liste-objets > li').slice(0, 5).each((i, el) => {
      const title = $(el).find('h3').text().trim();
      const date = $(el).find('.date').text().trim();
      console.log(JSON.stringify({ title, date }));
    });
  } catch (err) {
    console.error(err.message);
  }
}
run();
