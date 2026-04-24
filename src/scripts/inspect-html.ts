import fs from 'fs';

async function run() {
    const t = fs.readFileSync('temp.html', 'utf8');
    const idx = t.indexOf('id="ajax-wrapper"');
    if (idx !== -1) {
        console.log(t.substring(idx, idx + 10000));
    } else {
        console.log("ajax-wrapper NOT FOUND");
    }
}
run();
