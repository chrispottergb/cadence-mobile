const PREFIX = 'speech:';
export const speechAsset = (text: string) => `${PREFIX}${encodeURIComponent(text)}`;
export function speechText(assetId: string): string | null {
  if (!assetId.startsWith(PREFIX)) return null;
  try { return decodeURIComponent(assetId.slice(PREFIX.length)); } catch { return null; }
}
/** Conservative scheduling estimate; actual completion controls duck release. */
export const speechDuration = (text: string) => Math.max(2, text.trim().split(/\s+/).length / 2 + 1);
