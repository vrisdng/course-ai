// Renders a specific page from a PDF file to a PNG image.
// Used to generate page thumbnails for the sidebar citation viewer.
// 
// This helper loads a PDF from a Uint8Array (in-memory), renders a specific
// page to a canvas, and returns the PNG data URL. It uses pdf.js internally.
// 
// Note: pdf.js is heavy. This function should only be called during ingestion
// or on-demand for thumbnails, not for every citation click.

const PDFJS_LIB_URL = "https://esm.sh/pdfjs-dist@4.9.157/build/pdf.min.mjs";

let pdfjsWorker: Worker | null = null;
let pdfjsLoader: Promise<typeof import("pdfjs-dist")> | null = null;

async function loadPdfJs() {
  if (pdfjsLoader) return pdfjsLoader;
  
  pdfjsLoader = import(PDFJS_LIB_URL);
  return pdfjsLoader;
}

export async function renderPdfPageToPng(
  pdfBytes: Uint8Array,
  pageNumber: number,
  width: number = 280,
): Promise<Uint8Array> {
  const pdfjs = await loadPdfJs();
  
  const loadingTask = pdfjs.getDocument({
    data: pdfBytes,
    useWorkerFactory: () => {
      if (!pdfjsWorker) {
        pdfjsWorker = new Worker(
          new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()
        );
      }
      return pdfjsWorker;
    },
  });
  
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(pageNumber);
  
  const viewport = page.getViewport({ scale: 1 });
  const scale = width / viewport.width;
  const scaledViewport = page.getViewport({ scale });
  
  const canvas = new OffscreenCanvas(scaledViewport.width, scaledViewport.height);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to get canvas context");
  }
  
  await page.render({
    canvasContext: context,
    viewport: scaledViewport,
  }).promise;
  
  const pngBlob = await canvas.convertToBlob({ type: "image/png" });
  const pngBytes = new Uint8Array(await pngBlob.arrayBuffer());
  
  await pdf.destroy();
  
  return pngBytes;
}
