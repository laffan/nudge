// One lazily loaded pdf.js, its worker, and the URLs of the assets it
// fetches at run time (vite.config.ts serves and bundles them under
// /pdfjs/). Without `wasmUrl` the JBIG2 and JPEG 2000 decoders never
// load and a scanned PDF renders blank.
import type * as PdfJs from "pdfjs-dist";

let loading: Promise<typeof PdfJs> | null = null;

export function getPdfjs(): Promise<typeof PdfJs> {
  loading ??= import("pdfjs-dist").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    return pdfjs;
  });
  return loading;
}

const base = (dir: string) => new URL(`pdfjs/${dir}/`, document.baseURI).href;

export function pdfjsAssets() {
  return {
    wasmUrl: base("wasm"),
    iccUrl: base("iccs"),
    standardFontDataUrl: base("standard_fonts"),
    cMapUrl: base("cmaps"),
    cMapPacked: true,
  };
}

/** Open a PDF from its bytes. pdf.js takes ownership of the buffer it is
 *  given, so it gets a copy and the caller keeps theirs. */
export async function openPdf(bytes: ArrayBuffer): Promise<PdfJs.PDFDocumentProxy> {
  const pdfjs = await getPdfjs();
  return pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)), ...pdfjsAssets() }).promise;
}
