import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_DIR = path.join(process.cwd(), 'intel-stack');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const DB_PATH = path.join(DB_DIR, 'arxiv_history.db');
export const db = new Database(DB_PATH);

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS papers (
      id TEXT,
      category TEXT,
      title TEXT,
      url TEXT,
      date TEXT,
      abstract TEXT,
      other_categories TEXT,
      PRIMARY KEY (id, category)
    );

    CREATE TABLE IF NOT EXISTS paper_fulltext (
      paper_id TEXT PRIMARY KEY,
      title TEXT,
      total_chunks INTEGER,
      fetched_at TEXT,
      source TEXT
    );

    CREATE TABLE IF NOT EXISTS paper_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id TEXT,
      section TEXT,
      chunk_index INTEGER,
      content TEXT
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS paper_chunks_fts USING fts5(
      paper_id,
      section,
      content,
      tokenize='porter unicode61'
    );
  `);
}

export function clearPapers() {
  db.prepare('DELETE FROM papers').run();
  db.prepare('DELETE FROM paper_fulltext').run();
  db.prepare('DELETE FROM paper_chunks').run();
  db.prepare('DELETE FROM paper_chunks_fts').run();
}

export function insertPaper(paper: any) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO papers (id, category, title, url, date, abstract, other_categories)
    VALUES (@id, @category, @title, @url, @date, @abstract, @other_categories)
  `);
  const info = stmt.run(paper);
  return info.changes;
}

export function getPapers(categories?: string[], date?: string, limit?: number) {
  let query = 'SELECT * FROM papers WHERE 1=1';
  const params: any[] = [];

  if (date && date !== 'latest') {
    query += ' AND date = ?';
    params.push(date);
  } else if (date === 'latest') {
    query += ' AND date = (SELECT MAX(date) FROM papers)';
  }

  if (categories && categories.length > 0) {
    const placeholders = categories.map(() => '?').join(',');
    query += ` AND category IN (${placeholders})`;
    params.push(...categories);
  }

  query += ' ORDER BY category ASC, id ASC';

  if (limit) {
    query += ' LIMIT ?';
    params.push(limit);
  }

  return db.prepare(query).all(...params);
}

export function getPapersByIds(ids: string[]) {
  if (!ids || ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const query = `SELECT * FROM papers WHERE id IN (${placeholders})`;
  return db.prepare(query).all(...ids);
}

export function getPaperById(id: string) {
  const query = `SELECT * FROM papers WHERE id = ? LIMIT 1`;
  return db.prepare(query).get(id) as any;
}

export function isPaperIndexed(paperId: string): boolean {
  const row = db.prepare('SELECT paper_id FROM paper_fulltext WHERE paper_id = ?').get(paperId);
  return !!row;
}

export function savePaperChunks(
  paperId: string,
  title: string,
  chunks: { section: string; chunkIndex: number; content: string }[],
  source: string
) {
  const saveTransaction = db.transaction(() => {
    // Delete any prior chunks for this paper
    db.prepare('DELETE FROM paper_chunks WHERE paper_id = ?').run(paperId);
    db.prepare('DELETE FROM paper_chunks_fts WHERE paper_id = ?').run(paperId);
    db.prepare('DELETE FROM paper_fulltext WHERE paper_id = ?').run(paperId);

    // Insert metadata
    db.prepare(`
      INSERT INTO paper_fulltext (paper_id, title, total_chunks, fetched_at, source)
      VALUES (?, ?, ?, ?, ?)
    `).run(paperId, title, chunks.length, new Date().toISOString(), source);

    // Insert chunks
    const insertChunk = db.prepare(`
      INSERT INTO paper_chunks (paper_id, section, chunk_index, content)
      VALUES (?, ?, ?, ?)
    `);

    const insertFts = db.prepare(`
      INSERT INTO paper_chunks_fts (paper_id, section, content)
      VALUES (?, ?, ?)
    `);

    for (const chunk of chunks) {
      insertChunk.run(paperId, chunk.section, chunk.chunkIndex, chunk.content);
      insertFts.run(paperId, chunk.section, chunk.content);
    }
  });

  saveTransaction();
}

export function getIndexedPaperStatus(paperIds: string[]) {
  if (!paperIds || paperIds.length === 0) return {};
  const placeholders = paperIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM paper_fulltext WHERE paper_id IN (${placeholders})`).all(...paperIds) as any[];
  
  const result: Record<string, { indexed: boolean; total_chunks?: number; source?: string; title?: string }> = {};
  for (const id of paperIds) {
    result[id] = { indexed: false };
  }
  for (const r of rows) {
    result[r.paper_id] = {
      indexed: true,
      total_chunks: r.total_chunks,
      source: r.source,
      title: r.title
    };
  }
  return result;
}

export function searchPaperChunks(
  rawQuery: string,
  paperIds?: string[],
  topK: number = 5
): { paper_id: string; title: string; section: string; content: string; score?: number }[] {
  // Sanitize query tokens for SQLite FTS5
  const tokens = rawQuery
    .replace(/[^\w\s-]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(t => t.length > 1 && !['what', 'where', 'when', 'how', 'does', 'the', 'and', 'for', 'with', 'about', 'paper', 'papers'].includes(t.toLowerCase()));

  let results: any[] = [];

  // Try FTS5 first
  if (tokens.length > 0) {
    const ftsQuery = tokens.map(t => `"${t}"*`).join(' OR ');

    try {
      if (paperIds && paperIds.length > 0) {
        const placeholders = paperIds.map(() => '?').join(',');
        const sql = `
          SELECT c.paper_id, f.title, c.section, c.content, bm25(paper_chunks_fts) as rank
          FROM paper_chunks_fts
          JOIN paper_chunks c ON c.rowid = paper_chunks_fts.rowid
          LEFT JOIN paper_fulltext f ON f.paper_id = c.paper_id
          WHERE paper_chunks_fts MATCH ?
          AND c.paper_id IN (${placeholders})
          ORDER BY rank ASC
          LIMIT ?
        `;
        results = db.prepare(sql).all(ftsQuery, ...paperIds, topK);
      } else {
        const sql = `
          SELECT c.paper_id, f.title, c.section, c.content, bm25(paper_chunks_fts) as rank
          FROM paper_chunks_fts
          JOIN paper_chunks c ON c.rowid = paper_chunks_fts.rowid
          LEFT JOIN paper_fulltext f ON f.paper_id = c.paper_id
          WHERE paper_chunks_fts MATCH ?
          ORDER BY rank ASC
          LIMIT ?
        `;
        results = db.prepare(sql).all(ftsQuery, topK);
      }
    } catch (err) {
      console.warn('FTS5 query failed, falling back to LIKE:', err);
    }
  }

  // Fallback: If FTS5 gave fewer results, run a substring / keyword LIKE search
  if (results.length < topK) {
    const needed = topK - results.length;
    const existingIds = new Set(results.map(r => `${r.paper_id}_${r.section}_${r.content.slice(0, 30)}`));

    // Try matching the primary search term
    const mainToken = tokens[0] || rawQuery.trim().slice(0, 20);
    if (mainToken) {
      let likeSql = `
        SELECT c.paper_id, f.title, c.section, c.content
        FROM paper_chunks c
        LEFT JOIN paper_fulltext f ON f.paper_id = c.paper_id
        WHERE c.content LIKE ?
      `;
      const likeParams: any[] = [`%${mainToken}%`];

      if (paperIds && paperIds.length > 0) {
        const placeholders = paperIds.map(() => '?').join(',');
        likeSql += ` AND c.paper_id IN (${placeholders})`;
        likeParams.push(...paperIds);
      }

      likeSql += ` LIMIT ?`;
      likeParams.push(needed * 2);

      const fallbackRows = db.prepare(likeSql).all(...likeParams) as any[];
      for (const row of fallbackRows) {
        const key = `${row.paper_id}_${row.section}_${row.content.slice(0, 30)}`;
        if (!existingIds.has(key)) {
          results.push(row);
          existingIds.add(key);
          if (results.length >= topK) break;
        }
      }
    }
  }

  // If still 0 results (e.g. general query or empty query), return key introduction/method chunks
  if (results.length === 0 && paperIds && paperIds.length > 0) {
    const placeholders = paperIds.map(() => '?').join(',');
    const defaultSql = `
      SELECT c.paper_id, f.title, c.section, c.content
      FROM paper_chunks c
      LEFT JOIN paper_fulltext f ON f.paper_id = c.paper_id
      WHERE c.paper_id IN (${placeholders})
      ORDER BY c.chunk_index ASC
      LIMIT ?
    `;
    results = db.prepare(defaultSql).all(...paperIds, topK);
  }

  return results.map(r => ({
    paper_id: r.paper_id,
    title: r.title || r.paper_id,
    section: r.section || 'General',
    content: r.content,
    score: r.rank
  }));
}
