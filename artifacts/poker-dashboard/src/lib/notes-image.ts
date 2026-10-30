// Shrinks a screenshot or photo to a JPEG of at most 1600px on its longest side before it is sent to
// be read: results notes are legible at that size, and the upload stays small and cheap to process.
const MAX_SIDE = 1600;

export async function prepareNotesImage(file: File): Promise<{ data: string; mediaType: "image/jpeg" }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no canvas");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return { data: canvas.toDataURL("image/jpeg", 0.85).split(",")[1] ?? "", mediaType: "image/jpeg" };
}
