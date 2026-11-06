import sharp from 'sharp';
import { MAX_IMAGE_BYTES } from '@sb/contracts';
import { fail } from '@sb/db';

const MAX_IMAGE_PIXELS = 16_000_000;
const mimeByFormat: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** Validate the complete image before persisting the original bytes. */
export async function decodeUpload(body: {
  contentType: string;
  dataBase64: string;
}): Promise<Buffer> {
  const bytes = Buffer.from(body.dataBase64, 'base64');
  if (
    !bytes.length ||
    bytes.length > MAX_IMAGE_BYTES ||
    bytes.toString('base64') !== body.dataBase64
  )
    fail('BAD_REQUEST');
  try {
    const image = sharp(bytes, { failOn: 'warning', limitInputPixels: MAX_IMAGE_PIXELS });
    const metadata = await image.metadata();
    if (
      !metadata.format ||
      mimeByFormat[metadata.format] !== body.contentType ||
      !metadata.width ||
      !metadata.height ||
      (metadata.pages ?? 1) !== 1
    )
      fail('BAD_REQUEST');
    // metadata() reads only headers; stats() forces full pixel decoding, including truncation checks.
    await image.stats();
  } catch {
    fail('BAD_REQUEST');
  }
  return bytes;
}
