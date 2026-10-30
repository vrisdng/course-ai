export interface ImportStudent { email: string; fullName?: string }
interface ParsedStudents { students: ImportStudent[]; invalid: string[] }
const validEmail = (email: string): boolean => email.length <= 254 && /^[^\s@",]+@[^\s@",]+\.[^\s@",]+$/.test(email);

export function parseStudentImport(text: string): ParsedStudents {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let closedQuote = false;
  const malformed = (): ParsedStudents => ({ students: [], invalid: ['Malformed CSV: check double quotes.'] });
  text = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { cell += '"'; index++; }
      else if (character === '"') { quoted = false; closedQuote = true; }
      else cell += character;
    } else if (character === '"') {
      if (cell.trim() || closedQuote) return malformed();
      cell = ''; quoted = true;
    } else if (character === ',' || character === '\r' || character === '\n') {
      row.push(cell.trim()); cell = ''; closedQuote = false;
      if (character !== ',') {
        rows.push(row); row = [];
        if (character === '\r' && text[index + 1] === '\n') index++;
      }
    } else {
      if (closedQuote && !/\s/.test(character)) return malformed();
      cell += character;
    }
  }
  if (quoted) return malformed();
  row.push(cell.trim()); rows.push(row);
  const nonempty = rows.filter((cells) => cells.some(Boolean));
  const header = nonempty[0];
  const namedHeader = header?.length === 2 && header[0].toLowerCase() === 'email' && /^(full[ _]?name|name)$/i.test(header[1]);
  if (namedHeader) nonempty.shift();
  else if (header?.[0].toLowerCase() === 'email') {
    header.shift();
    if (!header.length) nonempty.shift();
  }
  const students = new Map<string, ImportStudent>();
  const invalid: string[] = [];
  const entries = nonempty.flatMap((cells) => {
    const namedRow = cells.length === 2 && validEmail(cells[0]) && cells[1] && !validEmail(cells[1]);
    return namedHeader || namedRow ? [cells] : cells.filter(Boolean).map((email) => [email]);
  });
  for (const cells of entries) {
    const [rawEmail, fullName] = cells;
    if (cells.length > 2 || !validEmail(rawEmail) || (fullName?.length ?? 0) > 200) {
      invalid.push(cells.join(', ')); continue;
    }
    const email = rawEmail.toLowerCase();
    const previous = students.get(email);
    if (fullName && previous?.fullName && fullName !== previous.fullName) {
      invalid.push(`Conflicting names for ${email}`); continue;
    }
    const name = fullName || previous?.fullName;
    students.set(email, { email, ...(name ? { fullName: name } : {}) });
  }
  return { students: [...students.values()], invalid: [...new Set(invalid)] };
}
