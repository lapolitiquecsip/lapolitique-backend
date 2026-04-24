import AdmZip from 'adm-zip';

async function inspect() {
  const url = 'https://data.assemblee-nationale.fr/static/openData/repository/17/loi/scrutins/Scrutins.json.zip';
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const zip = new AdmZip(Buffer.from(buffer));
  const entry = zip.getEntries().find(e => e.entryName.endsWith('.json'));
  if (entry) {
    const content = JSON.parse(entry.getData().toString('utf8'));
    const groups = content.scrutin.ventilationVotes?.organe?.groupes?.groupe;
    console.log(JSON.stringify(groups, null, 2));
  }
}

inspect();
