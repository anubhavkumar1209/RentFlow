import QRCode from "qrcode";
import sharp from "sharp";

/** PNG of a QR code (for UPI links and receipt verification). */
export async function qrPng(text: string): Promise<Buffer> {
  return QRCode.toBuffer(text, { type: "png", errorCorrectionLevel: "M", margin: 2, width: 512 });
}

export async function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, { errorCorrectionLevel: "M", margin: 1, width: 240 });
}

/**
 * 64-bit difference hash ("dHash") of an image, as 16 hex characters. Re-sent
 * or re-compressed copies of the same screenshot hash to the same or nearly the
 * same value, so reuse can be caught without OCR (CLAUDE.md §8).
 */
export async function perceptualHash(bytes: Buffer): Promise<string> {
  const { data } = await sharp(bytes).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  let hex = "";
  for (let y = 0; y < 8; y++) {
    let nibble = 0;
    for (let x = 0; x < 8; x++) {
      const bit = (data[y * 9 + x] ?? 0) < (data[y * 9 + x + 1] ?? 0) ? 1 : 0;
      nibble = (nibble << 1) | bit;
      if (x % 4 === 3) {
        hex += nibble.toString(16);
        nibble = 0;
      }
    }
  }
  return hex;
}
