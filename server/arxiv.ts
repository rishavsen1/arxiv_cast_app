import axios from 'axios';
import https from 'https';
import { XMLParser } from 'fast-xml-parser';
import { insertPaper } from './db.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

export async function fetchFromArxiv(category: string, maxResults: number, date?: string) {
  let searchQuery = `cat:${category}`;
  if (date) {
    const dateStr = date.replace(/-/g, '');
    searchQuery += ` AND submittedDate:[${dateStr}0000 TO ${dateStr}2359]`;
  }

  const url = `http://export.arxiv.org/api/query?search_query=${encodeURIComponent(searchQuery)}&max_results=${maxResults}&sortBy=submittedDate&sortOrder=descending`;
  
  try {
    const response = await axios.get(url, {
      httpsAgent: new https.Agent({ rejectUnauthorized: false })
    });
    const xml = parser.parse(response.data);
    
    let entries = xml.feed.entry;
    if (!entries) return { found: 0, added: 0 };
    if (!Array.isArray(entries)) entries = [entries];

    let added = 0;
    for (const entry of entries) {
      const id = entry.id.split('/abs/')[1];
      const title = entry.title.replace(/\\s+/g, ' ').trim();
      const abstract = entry.summary.replace(/\\s+/g, ' ').trim();
      const published = entry.published.split('T')[0];
      const url = entry.id;
      
      let cats = entry.category;
      if (!Array.isArray(cats)) cats = [cats];
      const allCats = cats.map((c: any) => c['@_term']);
      const otherCats = allCats.filter((c: string) => c !== category).join(',');

      const changes = insertPaper({
        id,
        category,
        title,
        url,
        date: published,
        abstract,
        other_categories: otherCats
      });
      added += changes;
    }

    return { found: entries.length, added };
  } catch (error) {
    console.error('Error fetching from arXiv:', error);
    throw error;
  }
}
