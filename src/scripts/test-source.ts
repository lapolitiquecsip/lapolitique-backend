async function test() {
  try {
    const response = await fetch('https://www.nosdeputes.fr/deputes/json');
    const data = await response.json();
    const d = data.deputes[0].depute;
    console.log('Sample keys:', Object.keys(d));
    
    // Check for "17" or "XVII" in any field
    data.deputes.slice(0, 10).forEach((item: any) => {
      const dep = item.depute;
      console.log(`${dep.nom} -> mandat_debut: ${dep.mandat_debut}, mandat_fin: ${dep.mandat_fin}`);
    });
  } catch (e) {
    console.error('Error:', e);
  }
}

test();
