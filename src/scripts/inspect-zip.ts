
import AdmZip from 'adm-zip';

const SCRUTINS_ZIP_URL = 'https://data.assemblee-nationale.fr/static/openData/repository/17/loi/scrutins/Scrutins.json.zip';

async function inspectZip() {
  console.log('Downloading zip...');
  const response = await fetch(SCRUTINS_ZIP_URL);
  const buffer = await response.arrayBuffer();
  const zip = new AdmZip(Buffer.from(buffer));
  const zipEntries = zip.getEntries();
  
  // Find a sample JSON
  const sampleEntry = zipEntries.find(e => e.entryName.includes('VTANR5L17V4472.json')) || zipEntries.find(e => e.entryName.endsWith('.json'));
  
  if (sampleEntry) {
    console.log('Inspecting:', sampleEntry.entryName);
    const content = JSON.parse(sampleEntry.getData().toString('utf8'));
    console.log(JSON.stringify(content.scrutin, null, 2));
  } else {
    console.log('No JSON found');
  }
}

inspectZip();
