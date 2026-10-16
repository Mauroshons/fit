// Utilidades geométricas 2D sobre landmarks de MediaPipe Pose.
// Los landmarks vienen normalizados (0..1) sobre el frame; para medir ángulos
// reales hay que des-normalizar con el aspecto del video, si no los ángulos
// quedan distorsionados en cámaras 16:9.

export function toPixels(lm, width, height) {
  return { x: lm.x * width, y: lm.y * height, v: lm.visibility ?? 1 };
}

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Ángulo interno en `b` del vértice a-b-c, en grados (0..180).
 */
export function angle3(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y;
  const v2x = c.x - b.x, v2y = c.y - b.y;
  const n1 = Math.hypot(v1x, v1y), n2 = Math.hypot(v2x, v2y);
  if (n1 === 0 || n2 === 0) return NaN;
  let cos = (v1x * v2x + v1y * v2y) / (n1 * n2);
  cos = Math.min(1, Math.max(-1, cos));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Ángulo del segmento a->b respecto a la horizontal (0..90).
 * Útil para inclinación de torso y de brazos.
 */
export function angleToHorizontal(a, b) {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if (dx === 0 && dy === 0) return NaN;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

export function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v ?? 1, b.v ?? 1) };
}

// --- Estadística simple para agregar ciclos de pedaleo ---

export function mean(arr) {
  const v = arr.filter(Number.isFinite);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
}

export function median(arr) {
  const v = arr.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function stdev(arr) {
  const v = arr.filter(Number.isFinite);
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
}

export function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

/** Filtro exponencial para suavizar landmarks frame a frame. */
export class EMA {
  constructor(alpha = 0.4) {
    this.alpha = alpha;
    this.state = null;
  }
  push(points) {
    if (!this.state) {
      this.state = points.map((p) => ({ ...p }));
      return this.state;
    }
    const a = this.alpha;
    this.state = points.map((p, i) => ({
      x: a * p.x + (1 - a) * this.state[i].x,
      y: a * p.y + (1 - a) * this.state[i].y,
      z: a * (p.z ?? 0) + (1 - a) * (this.state[i].z ?? 0),
      visibility: p.visibility ?? 1,
    }));
    return this.state;
  }
  reset() {
    this.state = null;
  }
}
