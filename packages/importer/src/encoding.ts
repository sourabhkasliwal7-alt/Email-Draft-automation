export type DetectedEncoding = "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";

/**
 * Decodes an uploaded text file. Honours BOMs (UTF-8, UTF-16 LE/BE); otherwise tries strict UTF-8 and falls back to
 * Windows-1252, which is what Excel's "CSV" export produces on Windows. Never throws on odd bytes.
 */
export function decodeBytes(bytes: Uint8Array): { text: string; encoding: DetectedEncoding; bom: boolean } {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "utf-8", bom: true };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "utf-16le", bom: true };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), encoding: "utf-16be", bom: true };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8", bom: false };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252", bom: false };
  }
}
