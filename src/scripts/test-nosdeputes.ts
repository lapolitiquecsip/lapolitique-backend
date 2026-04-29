
// import fetch from 'node-fetch'; // Not needed in Node 22+

async function test() {
  const res = await fetch('https://www.nosdeputes.fr/alain-david/json');
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

test();
