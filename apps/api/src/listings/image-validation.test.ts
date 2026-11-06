import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { decodeUpload } from './image-validation.js';
import { MAX_IMAGE_BYTES } from '@sb/contracts';

const pixels = { create: { width: 4, height: 4, channels: 3 as const, background: '#abc123' } };

describe('uploaded image decoding', () => {
  it.each(['jpeg', 'png', 'webp'] as const)(
    'accepts actual %s pixels without changing the file',
    async (format) => {
      const bytes = await sharp(pixels).toFormat(format).toBuffer();
      expect(
        await decodeUpload({
          contentType: `image/${format}`,
          dataBase64: bytes.toString('base64'),
        }),
      ).toEqual(bytes);
    },
  );

  it('rejects non-image bytes, malformed base64, MIME spoofing and truncated pixel data', async () => {
    const png = await sharp(pixels).png().toBuffer();
    const jpeg = await sharp(pixels).jpeg().toBuffer();
    for (const body of [
      { contentType: 'image/png', dataBase64: Buffer.from('not-an-image').toString('base64') },
      { contentType: 'image/png', dataBase64: png.toString('base64') + '!' },
      { contentType: 'image/jpeg', dataBase64: png.toString('base64') },
      {
        contentType: 'image/jpeg',
        dataBase64: jpeg.subarray(0, jpeg.length - 15).toString('base64'),
      },
      { contentType: 'image/png', dataBase64: png.subarray(0, 36).toString('base64') },
    ])
      await expect(decodeUpload(body)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('rejects files above the byte and pixel limits', async () => {
    await expect(
      decodeUpload({
        contentType: 'image/png',
        dataBase64: Buffer.alloc(MAX_IMAGE_BYTES + 1).toString('base64'),
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    // This compresses to a small file but must still be rejected by decoded pixel size.
    const large = await sharp({
      create: { width: 4001, height: 4000, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();
    await expect(
      decodeUpload({ contentType: 'image/png', dataBase64: large.toString('base64') }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('rejects animated uploads instead of only checking their first frame', async () => {
    const frames = Buffer.from([
      ...Array(4).fill([255, 0, 0]).flat(),
      ...Array(4).fill([0, 255, 0]).flat(),
    ]);
    const bytes = await sharp(frames, { raw: { width: 2, height: 4, channels: 3, pageHeight: 2 } })
      .webp()
      .toBuffer();
    expect((await sharp(bytes).metadata()).pages).toBe(2);
    await expect(
      decodeUpload({ contentType: 'image/webp', dataBase64: bytes.toString('base64') }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
