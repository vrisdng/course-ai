// Renders PDF pages to WebP with pdf.js on a native canvas, and reads each
// page's text lines in the same pass. Runs in Node (Vercel), not the browser.
import { createRequire } from "node:module";
import path from "node:path";

import { createCanvas } from "@napi-rs/canvas";
import { getDocument, type PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

import { groupTextItemsIntoLines, type PageLine } from "./textLines.js";

const WEBP_QUALITY = 80;

type TextContentItem = Awaited<ReturnType<PDFPageProxy["getTextContent"]>>["items"][number];
type TextItem = Extract<TextContentItem, { str: string }>;

// pdf.js loads fonts, character maps and image decoders from its package
// directory at runtime. vercel.json includes these folders in the bundle.
const pdfjsRoot = path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
const assetDir = (name: string) => `${path.join(pdfjsRoot, name)}${path.sep}`;

export interface RenderedPageImage {
  image: Uint8Array;
  width: number;
  height: number;
  lines: PageLine[];
}

export interface OpenedPdf {
  pageCount: number;
  renderPage(pageNumber: number, width: number): Promise<RenderedPageImage>;
  close(): Promise<void>;
}

export async function openPdf(bytes: Uint8Array): Promise<OpenedPdf> {
  const document = await getDocument({
    // pdf.js transfers (detaches) the buffer it is given, so pass a copy.
    data: bytes.slice(),
    standardFontDataUrl: assetDir("standard_fonts"),
    cMapUrl: assetDir("cmaps"),
    cMapPacked: true,
    wasmUrl: assetDir("wasm"),
    isEvalSupported: false,
    useSystemFonts: false,
  }).promise;

  return {
    pageCount: document.numPages,

    async renderPage(pageNumber: number, width: number): Promise<RenderedPageImage> {
      const page = await document.getPage(pageNumber);
      try {
        const unscaled = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: width / unscaled.width });
        const canvasWidth = Math.round(viewport.width);
        const canvasHeight = Math.round(viewport.height);

        const canvas = createCanvas(canvasWidth, canvasHeight);
        const context = canvas.getContext("2d");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvasWidth, canvasHeight);

        await page.render({
          // pdf.js types expect DOM canvas types; @napi-rs/canvas implements the same API.
          canvas: canvas as unknown as HTMLCanvasElement,
          canvasContext: context as unknown as CanvasRenderingContext2D,
          viewport,
        }).promise;

        const textContent = await page.getTextContent();
        const items = textContent.items.filter((item): item is TextItem => "str" in item);

        return {
          image: new Uint8Array(await canvas.encode("webp", WEBP_QUALITY)),
          width: canvasWidth,
          height: canvasHeight,
          lines: groupTextItemsIntoLines(items, viewport),
        };
      } finally {
        page.cleanup();
      }
    },

    async close() {
      await document.destroy();
    },
  };
}
