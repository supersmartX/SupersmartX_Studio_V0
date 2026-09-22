export function getCanvasContext(canvas: HTMLCanvasElement, willReadFrequently = false): CanvasRenderingContext2D | null {
  return canvas.getContext('2d', { willReadFrequently }) ?? canvas.getContext('2d');
}
