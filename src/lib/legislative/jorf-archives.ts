export interface JorfArchiveSelection {
  year?: number;
  through?: string;
}

export function selectJorfArchiveUrls(html: string, directoryUrl: string, selection: JorfArchiveSelection = {}) {
  const names = [...new Set(
    // Seulement les archives QUOTIDIENNES. Le 08/11/2026, la DILA a purgé le répertoire et n'y
    // a laissé que le stock complet « Freemium_jorf_simple_20261108-… » (1,2 Go, toutes les
    // éditions depuis 1905) : on ne le prend jamais, les quotidiens reprennent ensuite.
    [...html.matchAll(/href="((?!Freemium)[A-Za-z_]*?_(\d{8})-\d{6}\.tar\.gz)"/gi)]
      .map(match => ({ name: match[1], date: match[2] })),
  )].sort((a, b) => a.name.localeCompare(b.name));

  if (selection.year) {
    const prefix = String(selection.year);
    const cutoff = selection.through?.replaceAll("-", "");
    return names
      .filter(archive => archive.date.startsWith(prefix) && (!cutoff || archive.date <= cutoff))
      .map(archive => new URL(archive.name, directoryUrl).toString());
  }

  const latest = names.at(-1);
  return latest ? [new URL(latest.name, directoryUrl).toString()] : [];
}
