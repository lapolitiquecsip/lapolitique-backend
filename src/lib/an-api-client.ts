import Parser from 'rss-parser';

export interface LegislativeDoc {
  title: string;
  url: string;
  category: 'Projet de loi' | 'Proposition de loi' | 'Autre';
  author: string;
  dateStr: string;
  dossierId: string;
}

const parser = new Parser();

export async function fetchLatestLegislativeDocs(): Promise<LegislativeDoc[]> {
  const feedUrl = 'http://www2.assemblee-nationale.fr/feeds/detail/documents-parlementaires';
  console.log(`[AN-API-CLIENT] Fetching latest legislative documents from RSS feed: ${feedUrl}`);
  
  try {
    const feed = await parser.parseURL(feedUrl);
    const docs: LegislativeDoc[] = [];
    
    for (const item of feed.items) {
      const title = item.title || '';
      const url = item.link || '';
      
      const isProjet = title.toLowerCase().includes('projet de loi');
      const isProposition = title.toLowerCase().includes('proposition de loi');
      
      if (!isProjet && !isProposition) continue;
      
      const category = isProjet ? 'Projet de loi' : 'Proposition de loi';
      
      // Extract dossier ID from URL
      let dossierId = '';
      const dlMatch = url.match(/dossiers_legislatifs\/([a-zA-Z0-9_]+)/i);
      if (dlMatch) {
        dossierId = dlMatch[1];
      } else {
        const lastSegment = url.split('/').pop() || '';
        if (lastSegment.length > 3) {
          dossierId = lastSegment;
        }
      }
      
      // Guess author for propositions de loi
      let author = category === 'Projet de loi' ? 'Le Gouvernement' : 'Député(s)';
      const desc = item.contentSnippet || item.content || '';
      
      // Match author from description (e.g. "présenté par M. Jean Dupont...")
      const authorMatch = desc.match(/(?:présenté[e]? par|déposé[e]? par) (?:M\.|Mme)?\s*([^,\.\n\r]+)/i) || 
                          title.match(/(?:présenté[e]? par|déposé[e]? par) (?:M\.|Mme)?\s*([^,\.\n\r]+)/i);
      if (authorMatch && category === 'Proposition de loi') {
        author = authorMatch[1].trim();
      }
      
      docs.push({
        title: title.replace(/\s+/g, ' ').trim(),
        url,
        category,
        author,
        dateStr: item.pubDate || new Date().toISOString(),
        dossierId
      });
    }
    
    console.log(`[AN-API-CLIENT] Found ${docs.length} relevant legislative documents in the RSS feed.`);
    return docs;
  } catch (error: any) {
    console.error(`[AN-API-CLIENT] Error fetching/parsing RSS feed: ${error.message}`);
    throw error;
  }
}
