export function drawWatermark(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  const fontSize = Math.max(14, Math.round(width * 0.035));
  ctx.font = `bold ${fontSize}px Inter, sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  const text = 'SupersmartX';
  const metrics = ctx.measureText(text);
  const padding = 8;
  const bgWidth = metrics.width + padding * 2;
  const bgHeight = fontSize + padding;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(width - bgWidth - 12, height - bgHeight - 12, bgWidth, bgHeight);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillText(text, width - 12 - padding, height - 12 - padding / 2);
  ctx.restore();
}
