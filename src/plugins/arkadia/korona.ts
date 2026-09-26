import type { LabelDrawContext, LabelSnapshot, LabelStyle } from 'mudlet-map-editor';

/**
 * A crown in front of the text, for kingdoms and provinces. Drawn as a shape
 * rather than a glyph, so it takes the label's text colour and looks the same
 * whatever fonts the viewer has — an emoji crown would bring its own colours.
 *
 * The crown's room is a `contentInsets` on the left, so "fit to text" leaves
 * space for it and centred text stays centred on the words, not the crown.
 */

/** Crown size and gap as a share of the font size. */
const HEIGHT = 0.62;
const WIDTH = 0.85;
const GAP = 0.3;

const fontSize = (label: LabelSnapshot) => label.font.size;

function traceCrown(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const band = h * 0.22;
  const top = y;
  const bottom = y + h;
  ctx.beginPath();
  // Band, then three points: the outer two lower than the middle one.
  ctx.moveTo(x, bottom);
  ctx.lineTo(x + w, bottom);
  ctx.lineTo(x + w, top + h * 0.18);
  ctx.lineTo(x + w * 0.72, bottom - band - h * 0.28);
  ctx.lineTo(x + w / 2, top);
  ctx.lineTo(x + w * 0.28, bottom - band - h * 0.28);
  ctx.lineTo(x, top + h * 0.18);
  ctx.closePath();
}

export const KORONA_STYLE: LabelStyle = {
  id: 'ark-korona',
  name: 'Korona',

  contentInsets({ label }) {
    return { left: fontSize(label) * (WIDTH + GAP) };
  },

  decorate(c: LabelDrawContext) {
    const size = fontSize(c.label);
    const w = size * WIDTH;
    const h = size * HEIGHT;
    // `box.left` already includes the inset above; the crown sits in it.
    const x = c.box.left - size * (WIDTH + GAP);
    const middle = c.box.top + (c.height - c.box.top - c.box.bottom) / 2;
    const { ctx } = c;
    ctx.save();
    ctx.fillStyle = c.colorToCss(c.label.fgColor);
    traceCrown(ctx, x, middle - h / 2, w, h);
    ctx.fill();
    // Jewels on the three tips.
    const r = size * 0.07;
    for (const [px, py] of [[x, middle - h / 2 + h * 0.18], [x + w / 2, middle - h / 2], [x + w, middle - h / 2 + h * 0.18]]) {
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  },
};
