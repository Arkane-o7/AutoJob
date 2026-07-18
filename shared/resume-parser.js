(function(root) {
  "use strict";

  /** @type {any} */
  const ApplyOS = root.ApplyOS = root.ApplyOS || {};
  let pdfJsPromise = null;

  function normalizeExtractedText(value) {
    return String(value || "")
      .replace(/\u0000/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function pageText(items) {
    const lines = [];
    let line = [];
    let previousY = null;

    for (const item of items || []) {
      const text = String(item?.str || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      const y = Number(item?.transform?.[5]);
      if (line.length && Number.isFinite(y) && Number.isFinite(previousY) && Math.abs(y - previousY) > 2) {
        lines.push(line.join(" "));
        line = [];
      }
      line.push(text);
      previousY = Number.isFinite(y) ? y : previousY;
      if (item?.hasEOL) {
        lines.push(line.join(" "));
        line = [];
        previousY = null;
      }
    }
    if (line.length) lines.push(line.join(" "));
    return normalizeExtractedText(lines.join("\n"));
  }

  function dataUrlBytes(dataUrl) {
    const match = String(dataUrl || "").match(/^data:[^;,]+;base64,([a-z0-9+/=\s]+)$/i);
    if (!match) throw new Error("The saved resume file could not be read.");
    const binary = root.atob(match[1].replace(/\s+/g, ""));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  async function sourceBytes(source) {
    if (typeof source === "string") return dataUrlBytes(source);
    if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    if (Object.prototype.toString.call(source) === "[object ArrayBuffer]") return new Uint8Array(source);
    if (source?.arrayBuffer) return new Uint8Array(await source.arrayBuffer());
    throw new Error("The selected resume file could not be read.");
  }

  async function loadPdfJs() {
    if (!pdfJsPromise) {
      pdfJsPromise = import(root.chrome.runtime.getURL("shared/vendor/pdf.mjs")).then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = root.chrome.runtime.getURL("shared/vendor/pdf.worker.mjs");
        return pdfjs;
      });
    }
    return pdfJsPromise;
  }

  async function extractPdfText(source, pdfjsOverride = null) {
    const pdfjs = pdfjsOverride || await loadPdfJs();
    const loadingTask = pdfjs.getDocument({
      data: await sourceBytes(source),
      isEvalSupported: false,
      useSystemFonts: true
    });
    const document = await loadingTask.promise;
    const pages = [];

    try {
      const pageCount = Math.min(Number(document.numPages || 0), 50);
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = pageText(content.items);
        if (text) pages.push(text);
        page.cleanup?.();
      }
    } finally {
      await document.destroy?.();
    }

    return normalizeExtractedText(pages.join("\n\n"));
  }

  ApplyOS.extractPdfText = extractPdfText;
  ApplyOS.normalizeExtractedResumeText = normalizeExtractedText;
})(globalThis);
