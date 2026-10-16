// Núcleo de medición: extrae métricas articulares por frame, segmenta los
// ciclos de pedaleo y agrega los resultados de la sesión.

import { toPixels, dist, angle3, angleToHorizontal, median, stdev, minOf, maxOf } from './geometry.js';

export const LM = {
  nose: 0,
  earL: 7, earR: 8,
  shoulderL: 11, shoulderR: 12,
  elbowL: 13, elbowR: 14,
  wristL: 15, wristR: 16,
  hipL: 23, hipR: 24,
  kneeL: 25, kneeR: 26,
  ankleL: 27, ankleR: 28,
  heelL: 29, heelR: 30,
  footL: 31, footR: 32,
};

// Conexiones dibujadas en el overlay (solo tronco + extremidades relevantes).
export const SKELETON = [
  ['shoulderL', 'elbowL'], ['elbowL', 'wristL'],
  ['shoulderR', 'elbowR'], ['elbowR', 'wristR'],
  ['shoulderL', 'hipL'], ['shoulderR', 'hipR'],
  ['shoulderL', 'shoulderR'], ['hipL', 'hipR'],
  ['hipL', 'kneeL'], ['kneeL', 'ankleL'], ['ankleL', 'footL'], ['ankleL', 'heelL'], ['heelL', 'footL'],
  ['hipR', 'kneeR'], ['kneeR', 'ankleR'], ['ankleR', 'footR'], ['ankleR', 'heelR'], ['heelR', 'footR'],
];

/**
 * Decide qué hemicuerpo está más cerca de la cámara en vista lateral.
 * Usa la visibilidad media de cadera/rodilla/tobillo.
 */
export function pickSide(landmarks, forced = 'auto') {
  if (forced === 'left' || forced === 'right') return forced;
  const vis = (idx) => landmarks[idx]?.visibility ?? 0;
  const left = (vis(LM.hipL) + vis(LM.kneeL) + vis(LM.ankleL) + vis(LM.shoulderL)) / 4;
  const right = (vis(LM.hipR) + vis(LM.kneeR) + vis(LM.ankleR) + vis(LM.shoulderR)) / 4;
  return right >= left ? 'right' : 'left';
}

/** Devuelve los puntos en píxeles del lado elegido + los comunes. */
export function sidePoints(landmarks, side, width, height) {
  const S = side === 'right' ? 'R' : 'L';
  const g = (name) => toPixels(landmarks[LM[name + S]], width, height);
  return {
    shoulder: g('shoulder'),
    elbow: g('elbow'),
    wrist: g('wrist'),
    hip: g('hip'),
    knee: g('knee'),
    ankle: g('ankle'),
    heel: g('heel'),
    foot: g('foot'),
    ear: toPixels(landmarks[side === 'right' ? LM.earR : LM.earL], width, height),
  };
}

/**
 * Métricas sagitales de un frame. Todas en grados salvo las que indican px.
 * La imagen tiene el eje Y hacia abajo: por eso "más arriba" = menor y.
 */
// Por debajo de esto MediaPipe está extrapolando la posición en vez de verla.
// Las muñecas sobre el manillar son el caso típico: quedan tapadas por el
// antebrazo y la propia barra, y el modelo devuelve una coordenada inventada.
export const MIN_VIS = 0.5;

/** Comprueba que todos los puntos implicados se estén viendo de verdad. */
function seen(...points) {
  return points.every((pt) => (pt?.v ?? 0) >= MIN_VIS);
}

/** Ángulo medido solo si sus tres puntos son visibles; si no, NaN. */
function angleIfSeen(a, b, c) {
  return seen(a, b, c) ? angle3(a, b, c) : NaN;
}

export function frameMetricsSagittal(p) {
  return {
    knee: angleIfSeen(p.hip, p.knee, p.ankle),         // extensión de rodilla
    hip: angleIfSeen(p.shoulder, p.hip, p.knee),       // apertura cadera-torso
    elbow: angleIfSeen(p.shoulder, p.elbow, p.wrist),  // flexión de codo
    shoulder: angleIfSeen(p.hip, p.shoulder, p.elbow), // ángulo hombro (tronco-brazo)
    ankle: angleIfSeen(p.knee, p.ankle, p.foot),       // flexión plantar/dorsal
    torso: seen(p.hip, p.shoulder) ? angleToHorizontal(p.hip, p.shoulder) : NaN,
    arm: seen(p.shoulder, p.wrist) ? angleToHorizontal(p.shoulder, p.wrist) : NaN,
    // Visibilidad cruda de cada articulación, para avisar de qué no se está
    // viendo en lugar de devolver un número inventado.
    vis: {
      shoulder: p.shoulder.v, elbow: p.elbow.v, wrist: p.wrist.v,
      hip: p.hip.v, knee: p.knee.v, ankle: p.ankle.v, foot: p.foot.v,
    },
    // Hacia dónde mira el ciclista: en ruta el hombro queda por delante de la
    // cadera. Sirve para dar signo coherente a KOPS mire hacia donde mire.
    facing: Math.sign(p.shoulder.x - p.hip.x) || 1,
    // Desfase horizontal rodilla vs eje de pedal (proxy: metatarso).
    // Positivo = rodilla por delante del eje.
    kopsPx: seen(p.knee, p.foot)
      ? (p.knee.x - p.foot.x) * (Math.sign(p.shoulder.x - p.hip.x) || 1)
      : NaN,
    // Escala de referencia para estimar mm.
    femurPx: dist(p.hip, p.knee),
    tibiaPx: dist(p.knee, p.ankle),
  };
}

/** Métricas frontales: simetría y desviación de rodilla. */
export function frameMetricsFrontal(landmarks, width, height) {
  const g = (name) => toPixels(landmarks[LM[name]], width, height);
  const shL = g('shoulderL'), shR = g('shoulderR');
  const hipL = g('hipL'), hipR = g('hipR');
  const kneeL = g('kneeL'), kneeR = g('kneeR');
  const ankL = g('ankleL'), ankR = g('ankleR');
  const shoulderWidth = Math.abs(shL.x - shR.x) || 1;

  // Desviación lateral de la rodilla respecto a la línea cadera-tobillo,
  // normalizada por ancho de hombros (+ = hacia dentro / valgo).
  const dev = (hip, knee, ankle, sign) => {
    const t = (knee.y - hip.y) / ((ankle.y - hip.y) || 1);
    const lineX = hip.x + t * (ankle.x - hip.x);
    return (sign * (knee.x - lineX) * 100) / shoulderWidth;
  };

  return {
    shoulderTilt: angleToHorizontal(shL, shR),
    hipTilt: angleToHorizontal(hipL, hipR),
    kneeDevL: dev(hipL, kneeL, ankL, +1),
    kneeDevR: dev(hipR, kneeR, ankR, -1),
    headTilt: angleToHorizontal(g('earL'), g('earR')),
  };
}

/**
 * Segmenta ciclos de pedaleo siguiendo la fase angular del tobillo alrededor
 * del centro de su trayectoria (aprox. el eje de pedalier).
 */
export class PedalCycleTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.samples = [];       // frames del ciclo en curso
    this.cycles = [];        // ciclos completos agregados
    this.center = null;
    this.prevPhase = null;
    this.accum = 0;          // fase acumulada (rad)
    this.cycleStart = null;
    this.ankleTrack = [];    // historial para centrar la trayectoria
  }

  /** @returns {object|null} el ciclo recién cerrado, si lo hay */
  push(t, metrics, points) {
    const ankle = { x: points.ankle.x, y: points.ankle.y };
    this.ankleTrack.push(ankle);
    if (this.ankleTrack.length > 180) this.ankleTrack.shift();

    // Centro = punto medio del bounding box de la trayectoria reciente.
    const xs = this.ankleTrack.map((a) => a.x);
    const ys = this.ankleTrack.map((a) => a.y);
    const range = Math.max(...ys) - Math.min(...ys);
    this.center = {
      x: (Math.max(...xs) + Math.min(...xs)) / 2,
      y: (Math.max(...ys) + Math.min(...ys)) / 2,
      rangeY: range,
      rangeX: Math.max(...xs) - Math.min(...xs),
    };

    this.samples.push({ t, ...metrics, ankleX: ankle.x, ankleY: ankle.y });
    if (this.cycleStart === null) this.cycleStart = t;

    // Hasta tener trayectoria suficiente no intentamos cerrar ciclos.
    if (range < 20 || this.ankleTrack.length < 20) return null;

    const phase = Math.atan2(ankle.y - this.center.y, ankle.x - this.center.x);
    if (this.prevPhase !== null) {
      let d = phase - this.prevPhase;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      this.accum += d;
    }
    this.prevPhase = phase;

    if (Math.abs(this.accum) >= 2 * Math.PI) {
      // Arrastramos el sobrepaso en lugar de ponerlo a cero: a 30 fps y 90 rpm
      // cada frame avanza 18°, y descartar ese resto alargaba cada ciclo medio
      // frame, subestimando la cadencia un ~5%.
      this.accum -= Math.sign(this.accum) * 2 * Math.PI;
      const cycle = this.#closeCycle(t);
      this.samples = [this.samples[this.samples.length - 1]];
      this.cycleStart = t;
      if (cycle) this.cycles.push(cycle);
      return cycle;
    }
    return null;
  }

  #closeCycle(tEnd) {
    const s = this.samples.filter((x) => Number.isFinite(x.knee));
    if (s.length < 8) return null;

    const knees = s.map((x) => x.knee);
    const iMax = knees.indexOf(Math.max(...knees)); // punto muerto inferior
    const iMin = knees.indexOf(Math.min(...knees)); // punto muerto superior

    // Instante con el pie más adelantado (biela ~3 en punto) para KOPS.
    // El "delante" lo marca la orientación del ciclista, no la diferencia de X
    // entre puntos muertos: ahí el tobillo está casi en la misma vertical y el
    // signo saldría del ruido.
    const forwardSign = Math.sign(median(s.map((x) => x.facing))) || 1;
    let iFwd = 0;
    for (let i = 1; i < s.length; i++) {
      if (forwardSign * s[i].ankleX > forwardSign * s[iFwd].ankleX) iFwd = i;
    }

    return {
      durationMs: tEnd - this.cycleStart,
      kneeExtension: s[iMax].knee,          // máxima extensión (PMI)
      kneeFlexion: s[iMin].knee,            // máxima flexión (PMS)
      hipMin: minOf(s.map((x) => x.hip)),
      hipMax: maxOf(s.map((x) => x.hip)),
      ankleAtBdc: s[iMax].ankle,
      ankleAtTdc: s[iMin].ankle,
      ankleRom: maxOf(s.map((x) => x.ankle)) - minOf(s.map((x) => x.ankle)),
      torso: median(s.map((x) => x.torso)),
      elbow: median(s.map((x) => x.elbow)),
      shoulder: median(s.map((x) => x.shoulder)),
      arm: median(s.map((x) => x.arm)),
      kopsPx: s[iFwd].kopsPx,
      femurPx: median(s.map((x) => x.femurPx)),
      crankTravelPx: this.center?.rangeY ?? NaN,
      // Visibilidad mediana de cada articulación durante el ciclo.
      vis: Object.fromEntries(
        Object.keys(s[0].vis ?? {}).map((j) => [j, median(s.map((x) => x.vis?.[j]))]),
      ),
    };
  }

  /** Resumen de los últimos `n` ciclos válidos. */
  summary(n = 12) {
    const c = this.cycles.slice(-n);
    if (!c.length) return null;
    const col = (k) => c.map((x) => x[k]);
    // Mediana: el primer ciclo tras el arranque del seguimiento sale largo y
    // arrastraría la media hacia abajo.
    const cadence = median(col('durationMs').filter((d) => d > 300 && d < 3000).map((d) => 60000 / d));
    return {
      cycles: c.length,
      cadence,
      kneeExtension: median(col('kneeExtension')),
      kneeExtensionSd: stdev(col('kneeExtension')),
      kneeFlexion: median(col('kneeFlexion')),
      hipMin: median(col('hipMin')),
      hipMax: median(col('hipMax')),
      ankleAtBdc: median(col('ankleAtBdc')),
      ankleAtTdc: median(col('ankleAtTdc')),
      ankleRom: median(col('ankleRom')),
      torso: median(col('torso')),
      elbow: median(col('elbow')),
      shoulder: median(col('shoulder')),
      arm: median(col('arm')),
      kopsPx: median(col('kopsPx')),
      femurPx: median(col('femurPx')),
      crankTravelPx: median(col('crankTravelPx')),
      vis: Object.fromEntries(
        Object.keys(c[0].vis ?? {}).map((j) => [j, median(c.map((x) => x.vis?.[j]))]),
      ),
    };
  }
}

/**
 * Escala px->mm. La trayectoria vertical del tobillo mide ~2x la longitud de
 * biela, así que con la biela declarada obtenemos una calibración razonable.
 */
export function pxToMm(summary, crankLengthMm) {
  const travel = summary?.crankTravelPx;
  if (!Number.isFinite(travel) || travel < 20) return null;
  return (2 * crankLengthMm) / travel;
}
