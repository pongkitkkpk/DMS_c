/**
 * Draws `computePhaseChartSlices`' output onto an offscreen `<canvas>` and
 * returns it as a PNG `Blob`, for `exportDashboardExcel.js` to embed.
 *
 * Percentages live in the legend, never inside a slice: a slice for one
 * project out of forty is a sliver too thin to hold a label, and a chart
 * that reads fine for the big slices and not the small ones is not actually
 * easy to read. The legend reads the same regardless of slice size.
 *
 * The canvas is rendered at 2x `WIDTH`/`HEIGHT` (`SCALE`) so it stays crisp
 * rather than pixelating the moment someone zooms in on the sheet; the
 * returned `width`/`height` are the *logical* (1x) size the image should
 * occupy on the sheet — `exportDashboardExcel.js` pairs them with a doubled
 * `dpi` so the embedded image displays at that logical size, not its raw
 * pixel count.
 */
const SCALE = 2;
const WIDTH = 640;
const HEIGHT = 360;

function drawChart(ctx, slices, title) {
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = '#241f1c';
  ctx.font = 'bold 18px "Segoe UI", Tahoma, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(title, 24, 20);

  const cx = 160;
  const cy = 200;
  const radius = 110;
  let angle = -Math.PI / 2;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  for (const slice of slices) {
    const sweep = (slice.value / slices.reduce((s, x) => s + x.value, 0)) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, angle, angle + sweep);
    ctx.closePath();
    ctx.fillStyle = slice.color;
    ctx.fill();
    ctx.stroke();
    angle += sweep;
  }

  const legendX = 340;
  let legendY = 90;
  ctx.font = '14px "Segoe UI", Tahoma, sans-serif';
  for (const slice of slices) {
    ctx.fillStyle = slice.color;
    ctx.fillRect(legendX, legendY, 14, 14);
    ctx.fillStyle = '#241f1c';
    const pct = slice.percent.toFixed(1);
    ctx.fillText(`${slice.label} — ${slice.value} (${pct}%)`, legendX + 22, legendY);
    legendY += 26;
  }
}

/**
 * Resolves to `{ blob, width, height }` — `width`/`height` are the
 * *logical* (1x) size, for the caller to anchor the image at its intended
 * on-sheet size rather than its raw (2x) pixel size.
 */
export function renderPieChartPng(slices, title) {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * SCALE;
  canvas.height = HEIGHT * SCALE;
  const ctx = canvas.getContext('2d');
  drawChart(ctx, slices, title);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('สร้างภาพแผนภูมิไม่สำเร็จ'));
        return;
      }
      resolve({ blob, width: WIDTH, height: HEIGHT });
    }, 'image/png');
  });
}
