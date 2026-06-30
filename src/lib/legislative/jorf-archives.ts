export interface JorfArchiveSelection {
  year?: number;
  through?: string;
}

export function selectJorfArchiveUrls(html: string, directoryUrl: string, selection: JorfArchiveSelection = {}) {
  const names = [...new Set(
    [...html.matchAll(/href="(JORFSIMPLE_(\d{8})-\d{6}\.tar\.gz)"/g)]
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
