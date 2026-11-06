/** 휴대폰 원본 사진을 긴 변 1280px JPEG로 줄인다. `POST /images` 본문 형태로 돌려준다. */
export async function shrink(file: File): Promise<{ contentType: string; dataBase64: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
  return { contentType: 'image/jpeg', dataBase64: dataUrl.slice(dataUrl.indexOf(',') + 1) };
}
