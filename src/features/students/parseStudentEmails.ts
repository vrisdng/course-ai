export function parseStudentEmails(text: string): { emails: string[]; invalid: string[] } {
  const cells = text.replace(/^\uFEFF/, '').split(/[,\r\n]+/).map((cell) => cell.trim()).filter(Boolean)
    .map((cell) => cell.replace(/^"([^"\r\n]*)"$/, '$1').trim());
  if (cells[0]?.toLowerCase() === 'email') cells.shift();
  return {
    emails: [...new Set(cells.filter((email) => /^[^\s@",]+@[^\s@",]+\.[^\s@",]+$/.test(email)).map((email) => email.toLowerCase()))],
    invalid: [...new Set(cells.filter((email) => !/^[^\s@",]+@[^\s@",]+\.[^\s@",]+$/.test(email)))],
  };
}
