/**
 * SVG to PNG conversion utility using sharp
 */

import sharp from 'sharp';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

/**
 * Convert SVG string to PNG and save to file
 * @param svg - SVG string
 * @param outputPath - Output file path (should end with .png)
 * @param options - Optional settings
 * @returns Promise<string> - The output file path
 */
export async function svgToPng(
  svg: string,
  outputPath: string,
  options: {
    width?: number;
    height?: number;
    density?: number;  // DPI for SVG rendering
  } = {}
): Promise<string> {
  const { density = 150 } = options;

  // Ensure output directory exists
  const dir = dirname(outputPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Convert SVG to PNG using sharp
  const svgBuffer = Buffer.from(svg, 'utf-8');
  
  let pipeline = sharp(svgBuffer, { density });
  
  // Resize if dimensions specified
  if (options.width || options.height) {
    pipeline = pipeline.resize(options.width, options.height, {
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  await pipeline.png().toFile(outputPath);

  return outputPath;
}

/**
 * Generate a unique filename for backtest chart
 */
export function generateBacktestChartFilename(
  pair: string,
  timeframe: string,
  strategy: string,
  format: 'png' | 'svg' = 'png'
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safePair = pair.replace('_', '');
  return `backtest_${safePair}_${timeframe}_${strategy}_${timestamp}.${format}`;
}
