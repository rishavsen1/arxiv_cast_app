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
    )
  `);
}

export function clearPapers() {
  db.prepare('DELETE FROM papers').run();
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
