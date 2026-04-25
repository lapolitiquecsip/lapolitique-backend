
import axios from 'axios';
import * as fs from 'fs';
import path from 'path';

async function run() {
  try {
    const response = await axios.get('https://www2.assemblee-nationale.fr/documents/liste?type=projets-loi');
    fs.writeFileSync('scratch/an_bills.html', response.data);
    console.log('HTML saved to scratch/an_bills.html');
  } catch (err) {
    console.error(err.message);
  }
}
run();
