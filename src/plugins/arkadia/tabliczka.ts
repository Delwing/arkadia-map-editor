import type { LabelDrawContext, LabelSnapshot, LabelStyle } from 'mudlet-map-editor';
import { getLabelStyle } from 'mudlet-map-editor';

/**
 * The area-crossing plate, as a label style of its own: the same yellow caps on
 * a dark plate, square or with arrow ends pointing towards the area the exit
 * leads to.
 *
 * Everything shape-specific lives here. The editor only knows the hooks: it
 * fills nothing and strokes nothing for this style, so the plate and its frame
 * follow the outline, and `contentInsets` keeps the text out of the points.
 */

type Shape = 'rect' | 'pointLeft' | 'pointRight' | 'pointBoth';

type Pt = [number, number];

/** The plate's outline in a `w` × `h` box; `length` is how far a side point reaches, as a share of the height. */
function outline(shape: Shape, w: number, h: number, length: number): Pt[] {
  const run = length * h;
  // Never let the points cross each other on a box narrower than they are.
  const one = Math.min(run, w);
  const two = Math.min(run, w / 2);
  switch (shape) {
    case 'pointLeft': return [[one, 0], [w, 0], [w, h], [one, h], [0, h / 2]];
    case 'pointRight': return [[0, 0], [w - one, 0], [w, h / 2], [w - one, h], [0, h]];
    case 'pointBoth': return [[two, 0], [w - two, 0], [w, h / 2], [w - two, h], [two, h], [0, h / 2]];
    default: return [[0, 0], [w, 0], [w, h], [0, h]];
  }
}

function tracePath(ctx: CanvasRenderingContext2D, pts: Pt[]): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
}

/** Vertical room above and below the text: padding plus border, as the editor lays it out. */
function verticalClearance(label: LabelSnapshot): number {
  const p = label.padding;
  const pad = p === undefined ? 0 : Array.isArray(p) ? p[1] : p;
  const b = label.border;
  return Math.max(0, pad) + (b && b.width > 0 && b.color.alpha > 0 ? b.width : 0);
}

const shapeOf = (params: Readonly<Record<string, unknown>>) => params.shape as Shape;
const lengthOf = (params: Readonly<Record<string, unknown>>) => Number(params.length);

const pathFor = (c: LabelDrawContext) => outline(shapeOf(c.params), c.width, c.height, lengthOf(c.params));

/** The built-in caps style, looked up when used so a plugin overriding it is honoured. */
const caps = () => getLabelStyle('capsBigInitials');

export const TABLICZKA_STYLE: LabelStyle = {
  id: 'ark-tabliczka',
  name: 'Tabliczka',
  params: [
    {
      id: 'shape',
      name: 'Kształt',
      type: 'enum',
      default: 'rect',
      options: [
        { value: 'rect', name: 'Prostokąt' },
        { value: 'pointLeft', name: 'Strzałka w lewo' },
        { value: 'pointRight', name: 'Strzałka w prawo' },
        { value: 'pointBoth', name: 'Strzałki w obie strony' },
      ],
    },
    // A share of the height, so a two-line plate keeps the same angle; 0.5 is a right angle.
    { id: 'length', name: 'Długość strzałki', type: 'number', default: 0.5, min: 0.1, max: 1.5, step: 0.05 },
    { id: 'caps', name: 'Wielkie litery z dużymi inicjałami', type: 'bool', default: true },
  ],

  transformText(text, label, params) {
    const style = caps();
    return params.caps && style.transformText ? style.transformText(text, label, params) : text;
  },

  contentInsets({ label, params, height }) {
    const shape = shapeOf(params);
    const run = lengthOf(params) * height;
    // The text's top line sits `clear` below the top edge, which is where a
    // side point comes closest to it: by then its edge has pulled back
    // run × (1 − 2·clear/h) from the tip.
    const clear = Math.min(verticalClearance(label), height / 2);
    const side = run * Math.max(0, 1 - 2 * (height > 0 ? clear / height : 0));
    return {
      left: shape === 'pointLeft' || shape === 'pointBoth' ? side : 0,
      right: shape === 'pointRight' || shape === 'pointBoth' ? side : 0,
    };
  },

  drawBackground(c) {
    tracePath(c.ctx, pathFor(c));
    c.ctx.fillStyle = c.colorToCss(c.label.bgColor);
    c.ctx.fill();
  },

  drawText(c) {
    if (!c.params.caps) return;
    return caps().drawText?.(c);
  },

  measureText(c) {
    const style = caps();
    return c.params.caps && style.measureText ? style.measureText(c) : c.defaultMeasure();
  },

  // Stroked twice as wide and clipped to the plate, so exactly the inner half
  // shows: the frame hugs every edge, points included, and nothing spills out.
  drawBorder(c) {
    if (!c.borderWidth || !c.label.border) return;
    const { ctx } = c;
    const pts = pathFor(c);
    tracePath(ctx, pts);
    ctx.clip();
    tracePath(ctx, pts);
    ctx.lineWidth = c.borderWidth * 2;
    ctx.lineJoin = 'miter';
    ctx.strokeStyle = c.colorToCss(c.label.border.color);
    ctx.stroke();
  },
};
