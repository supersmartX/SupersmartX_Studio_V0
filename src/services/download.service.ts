export function generateFilename(type: 'video' | 'audio', extension?: string): string {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toTimeString().split(' ')[0].replace(/:/g, '-');
  const ext = extension || (type === 'video' ? 'webm' : 'wav');
  return `supersmartx-recording-${date}_${time}.${ext}`;
}
