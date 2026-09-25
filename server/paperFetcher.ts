import axios from 'axios';
import * as cheerio from 'cheerio';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');

export interface PaperChunk {
  section: string;
  chunkIndex: number;
  content: string;
}

export interface IngestedPaper {
  paperId: string;
  title: string;
  source: 'arxiv_html' | 'ar5iv_html' | 'arxiv_pdf' | 'fallback_abstract';
  chunks: PaperChunk[];
}

/**
 * Normalizes arXiv ID (removes version suffixes if needed, handles slash IDs)
 */
function cleanArxivId(rawId: string): string {
  let id = rawId.trim();
  if (id.startsWith('custom-')) return id;
  // If full url was given, extract id
  if (id.includes('/abs/')) {
    id = id.split('/abs/')[1];
  } else if (id.includes('/pdf/')) {
    id = id.split('/pdf/')[1].replace(/\.pdf$/, '');
  }
  return id;
}

/**
 * Splits text into overlapping chunks
 */
function splitIntoChunks(text: string, sectionTitle: string, chunkSize: number = 900, overlap: number = 150): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= chunkSize) {
    return [`[Section: ${sectionTitle}]\n${clean}`];
  }

  const chunks: string[] = [];
  let startIndex = 0;

  while (startIndex < clean.length) {
    let endIndex = startIndex + chunkSize;
    if (endIndex < clean.length) {
      // Try to break at a sentence or period
      const lastPeriod = clean.lastIndexOf('. ', endIndex);
      if (lastPeriod > startIndex + chunkSize * 0.6) {
        endIndex = lastPeriod + 1;
      } else {
        const lastSpace = clean.lastIndexOf(' ', endIndex);
        if (lastSpace > startIndex + chunkSize * 0.6) {
          endIndex = lastSpace;
        }
      }
    }

    const chunkContent = clean.slice(startIndex, endIndex).trim();
    if (chunkContent.length > 30) {
      chunks.push(`[Section: ${sectionTitle}]\n${chunkContent}`);
    }

    if (endIndex >= clean.length) break;
    startIndex = Math.max(startIndex + 1, endIndex - overlap);
  }

  return chunks;
}

/**
 * Attempts to fetch and parse paper from arXiv HTML (arxiv.org/html/ or ar5iv)
 */
async function tryFetchHtml(paperId: string): Promise<{ chunks: PaperChunk[]; source: 'arxiv_html' | 'ar5iv_html' } | null> {
  const cleanId = cleanArxivId(paperId);
  const urls: { url: string; source: 'arxiv_html' | 'ar5iv_html' }[] = [
    { url: `https://arxiv.org/html/${cleanId}`, source: 'arxiv_html' },
    { url: `https://ar5iv.labs.arxiv.org/html/${cleanId}`, source: 'ar5iv_html' },
  ];

  for (const target of urls) {
    try {
      const response = await axios.get(target.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        timeout: 10000,
        maxRedirects: 5,
        validateStatus: (status) => status === 200,
      });

      if (!response.data || typeof response.data !== 'string' || response.data.length < 500) {
        continue;
      }

      const $ = cheerio.load(response.data);

      // Remove non-content elements
      $('script, style, noscript, nav, header, footer, .ltx_bibliography, .ltx_page_footer, .ltx_page_header').remove();

      const chunks: PaperChunk[] = [];
      let globalChunkIdx = 0;

      // Extract sections
      const sections = $('section, .ltx_section, .ltx_subsection, article');

      if (sections.length > 0) {
        sections.each((_, el) => {
          const sec = $(el);
          const heading = sec.find('h1, h2, h3, h4, .ltx_title').first().text().replace(/\s+/g, ' ').trim() || 'General';
          
          // Get text clone without nested sub-sections already handled
          const text = sec.find('p, table, .ltx_para, .ltx_equation, ul, ol').text().replace(/\s+/g, ' ').trim();
          if (text.length > 40) {
            const secChunks = splitIntoChunks(text, heading);
            for (const c of secChunks) {
              chunks.push({
                section: heading,
                chunkIndex: globalChunkIdx++,
                content: c,
              });
            }
          }
        });
      }

      // If sections didn't yield enough or page was formatted differently
      if (chunks.length === 0) {
        const fullBodyText = $('body').text().replace(/\s+/g, ' ').trim();
        if (fullBodyText.length > 200) {
          const rawChunks = splitIntoChunks(fullBodyText, 'Full Paper');
          for (const c of rawChunks) {
            chunks.push({
              section: 'Full Paper',
              chunkIndex: globalChunkIdx++,
              content: c,
            });
          }
        }
      }

      if (chunks.length > 0) {
        return { chunks, source: target.source };
      }
    } catch {
      // Continue to next URL fallback
    }
  }

  return null;
}

/**
 * Attempts to fetch and parse paper from arXiv PDF
 */
async function tryFetchPdf(paperId: string): Promise<{ chunks: PaperChunk[]; source: 'arxiv_pdf' } | null> {
  const cleanId = cleanArxivId(paperId);
  const pdfUrl = `https://arxiv.org/pdf/${cleanId}.pdf`;

  try {
    const response = await axios.get(pdfUrl, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (ArxivCast Research Bot)',
      },
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: (status) => status === 200,
    });

    if (!response.data || response.data.byteLength < 1000) {
      return null;
    }

    const parser = new PDFParse({ data: Buffer.from(response.data) });
    const parsedData = await parser.getText();
    await parser.destroy();

    const text = typeof parsedData === 'string' ? parsedData : (parsedData?.text || '');
    if (!text || text.length < 300) {
      return null;
    }

    // Identify sections in PDF text
    const chunks: PaperChunk[] = [];
    let globalChunkIdx = 0;

    // Split text by typical section patterns
    const sectionSplitRegex = /\n(?=(?:[0-9]{1,2}\.?\s+)?(?:Abstract|Introduction|Related Work|Methodology|Method|Architecture|Model|Experiments?|Results|Discussion|Conclusion|Implementation Details|Ablation))/i;
    const rawSections = text.split(sectionSplitRegex);

    for (const rawSec of rawSections) {
      const trimmed = rawSec.trim();
      if (trimmed.length < 50) continue;

      const firstLine = trimmed.split('\n')[0].replace(/\s+/g, ' ').trim();
      const sectionName = firstLine.length < 60 ? firstLine : 'Section';

      const secChunks = splitIntoChunks(trimmed, sectionName);
      for (const c of secChunks) {
        chunks.push({
          section: sectionName,
          chunkIndex: globalChunkIdx++,
          content: c,
        });
      }
    }

    if (chunks.length === 0) {
      const fallbackChunks = splitIntoChunks(text, 'Full Document');
      for (const c of fallbackChunks) {
        chunks.push({
          section: 'Full Document',
          chunkIndex: globalChunkIdx++,
          content: c,
        });
      }
    }

    return { chunks, source: 'arxiv_pdf' };
  } catch (error) {
    console.warn(`PDF fetch failed for ${paperId}:`, error);
    return null;
  }
}

/**
 * Fetches the complete full text of an arXiv paper, chunks it into semantic sections,
 * and falls back gracefully to abstract if paper cannot be fetched.
 */
export async function fetchAndChunkPaper(
  paperId: string,
  paperTitle: string = '',
  paperAbstract: string = ''
): Promise<IngestedPaper> {
  const cleanId = cleanArxivId(paperId);

  // 1. Try HTML (fastest, cleanest structure)
  const htmlResult = await tryFetchHtml(cleanId);
  if (htmlResult && htmlResult.chunks.length > 0) {
    return {
      paperId: cleanId,
      title: paperTitle,
      source: htmlResult.source,
      chunks: htmlResult.chunks,
    };
  }

  // 2. Try PDF fallback
  const pdfResult = await tryFetchPdf(cleanId);
  if (pdfResult && pdfResult.chunks.length > 0) {
    return {
      paperId: cleanId,
      title: paperTitle,
      source: 'arxiv_pdf',
      chunks: pdfResult.chunks,
    };
  }

  // 3. Fallback to abstract chunks if external retrieval failed
  const abstractChunks: PaperChunk[] = [
    {
      section: 'Abstract & Overview',
      chunkIndex: 0,
      content: `[Section: Abstract]\nTitle: ${paperTitle}\nAbstract: ${paperAbstract}`,
    },
  ];

  return {
    paperId: cleanId,
    title: paperTitle,
    source: 'fallback_abstract',
    chunks: abstractChunks,
  };
}
