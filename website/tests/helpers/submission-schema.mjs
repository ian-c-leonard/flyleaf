import { readdir, readFile } from 'node:fs/promises';
export async function applySubmissionSchema(db) {
  // D1 exec splits on newlines. Send each complete statement, keeping trigger
  // bodies intact; these migrations have no SQL string with embedded whitespace.
  const dir = 'migrations/submissions';
  for (const name of (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = await readFile(`${dir}/${name}`, 'utf8');
    const statements = sql
      .replace(/^--.*$/gm, '')
      .split(/;\s*(?=CREATE|INSERT|ALTER|DROP)/)
      .map((s) => s.trim())
      .filter(Boolean);
    await db.batch(statements.map((s) => db.prepare(s)));
  }
}
