// Box and text-line primitives shared by page blocks (blocks.ts) and the
// page-image stage. Boxes are page fractions so they apply at any image size.
// Matching OCR text against the PDF text layer is on normalized words, since
// the two rarely agree character for character.

// [x0, y0, x1, y1] as fractions of the page width/height, top-left origin.
export type Box = [number, number, number, number];

export interface PageLine {
  text: string;
  box: Box;
}

export function tokenize(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function unionBoxes(boxes: Box[]): Box {
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}
