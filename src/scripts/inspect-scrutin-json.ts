import AdmZip from 'adm-zip';
import * as fs from 'fs';

async function inspect() {
  const zipPath = 'Scrutins.json.zip';
  // I need to download it first or use the one I have
  const url = 'https://data.assemblee-nationale.fr/static/openData/repository/17/loi/scrutins/Scrutins.json.zip';
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const zip = new AdmZip(Buffer.from(buffer));
  const entry = zip.getEntries().find(e => e.entryName.endsWith('.json'));
  if (entry) {
    const content = JSON.parse(entry.getData().toString('utf8'));
    console.log(JSON.stringify(content.scrutin.syntheseVote, null, 2));
  }
}

inspect();
