// Cotas de la bici medidas sobre un fotograma congelado.
//
// El caso de uso es reproducir una posición tras cambiar una pieza: un sillín
// nuevo tiene otro grosor de carcasa, otra longitud y otro punto de apoyo, así
// que "montarlo a la misma altura de raíles" deja la pelvis en otro sitio. Lo
// que se conserva son las cotas respecto al eje de pedalier.

import { dist } from './geometry.js';

/** Puntos que el usuario marca sobre la imagen, en orden de colocación. */
export const POINTS = [
  {
    key: 'bb', label: 'Centro del pedalier',
    hint: 'El eje alrededor del que giran las bielas. Es el origen de todas las cotas.',
  },
  {
    key: 'pedal', label: 'Eje del pedal',
    hint: 'Centro del eje del pedal. Calibra la escala: su distancia al pedalier es la longitud de biela, esté la biela donde esté.',
  },
  {
    key: 'nose', label: 'Punta del sillín',
    hint: 'El extremo delantero del sillín.',
  },
  {
    key: 'rear', label: 'Trasera del sillín',
    hint: 'Donde acaba la zona plana de apoyo, antes de que el sillín caiga.',
  },
  {
    key: 'bar', label: 'Centro del manillar',
    hint: 'Parte alta de la barra, junto a la potencia. Opcional: sin él no hay caída ni alcance.',
  },
];

export const REQUIRED = ['bb', 'pedal', 'nose', 'rear'];

/**
 * Convierte los puntos marcados en cotas reales.
 * @param {Record<string,{x:number,y:number}>} pts  puntos en píxeles de imagen
 * @param {number} crankLengthMm  longitud de biela declarada
 * @returns {{scale:number, facing:number, values:object[]}|null}
 */
export function computeMeasures(pts, crankLengthMm) {
  if (REQUIRED.some((k) => !pts[k])) return null;

  const crankPx = dist(pts.bb, pts.pedal);
  if (crankPx < 10) return null;                  // dos clics casi en el mismo sitio
  const scale = crankLengthMm / crankPx;          // mm por píxel

  // Hacia dónde apunta la bici. El manillar va delante; sin él, el sillín
  // queda por detrás del pedalier, que es cierto en cualquier bici de ruta.
  const facing = pts.bar
    ? (Math.sign(pts.bar.x - pts.nose.x) || 1)
    : (Math.sign(pts.bb.x - pts.nose.x) || 1);

  // Ejes en milímetros con origen en el pedalier. En imagen la Y crece hacia
  // abajo, así que se invierte para que "arriba" sea positivo.
  const up = (p) => (pts.bb.y - p.y) * scale;
  const back = (p) => (pts.bb.x - p.x) * facing * scale;

  // Referencia alta del sillín: el más elevado de punta y trasera, que es lo
  // que toca la cinta métrica al medir altura de sillín.
  const top = up(pts.nose) >= up(pts.rear) ? pts.nose : pts.rear;
  const topName = top === pts.nose ? 'punta' : 'trasera';

  const values = [
    {
      key: 'saddleHeight', label: 'Altura de sillín', unit: ' mm',
      value: dist(pts.bb, top) * scale,
      hint: `Distancia recta del pedalier al punto más alto del sillín (aquí, la ${topName}). Es la cota que replicas con cinta métrica al montar otro sillín.`,
    },
    {
      key: 'noseHeight', label: 'Altura de la punta', unit: ' mm',
      value: up(pts.nose),
      hint: 'Altura vertical de la punta sobre el pedalier.',
    },
    {
      key: 'rearHeight', label: 'Altura de la trasera', unit: ' mm',
      value: up(pts.rear),
      hint: 'Altura vertical de la trasera sobre el pedalier. Junto con la de la punta define el plano del sillín.',
    },
    {
      key: 'setback', label: 'Retroceso de la punta', unit: ' mm',
      value: back(pts.nose),
      hint: 'Distancia horizontal de la punta por detrás del pedalier. Positivo = por detrás.',
    },
    {
      key: 'rearSetback', label: 'Retroceso de la trasera', unit: ' mm',
      value: back(pts.rear),
      hint: 'Lo mismo para la trasera.',
    },
    {
      key: 'tilt', label: 'Inclinación del sillín', unit: '°',
      value: saddleTilt(pts.nose, pts.rear),
      hint: 'Ángulo del plano de apoyo respecto a la horizontal. Positivo = punta arriba.',
    },
    {
      key: 'saddleSpan', label: 'Longitud marcada', unit: ' mm',
      value: dist(pts.nose, pts.rear) * scale,
      hint: 'Separación entre los dos puntos que marcaste. No es la longitud del sillín de catálogo, pero sirve para comprobar que marcas en sitios equivalentes al comparar.',
    },
  ];

  if (pts.bar) {
    values.push(
      {
        key: 'drop', label: 'Caída sillín→manillar', unit: ' mm',
        value: up(top) - up(pts.bar),
        hint: 'Cuánto queda el manillar por debajo del sillín. Positivo = manillar más bajo.',
      },
      {
        key: 'reach', label: 'Alcance sillín→manillar', unit: ' mm',
        value: back(pts.nose) - back(pts.bar),
        hint: 'Distancia horizontal de la punta del sillín al centro del manillar.',
      },
    );
  }

  return { scale, facing, values };
}

/** Inclinación del plano de apoyo; positivo = punta arriba. */
function saddleTilt(nose, rear) {
  const dx = Math.abs(rear.x - nose.x);
  if (dx < 1) return NaN;
  return (Math.atan2(rear.y - nose.y, dx) * 180) / Math.PI;
}

/**
 * Compara dos fichas de cotas y devuelve las diferencias.
 * Solo compara claves presentes en ambas.
 */
export function diffMeasures(before, after) {
  const a = new Map(before.values.map((v) => [v.key, v]));
  return after.values
    .filter((v) => a.has(v.key))
    .map((v) => {
      const prev = a.get(v.key);
      const delta = v.value - prev.value;
      return {
        key: v.key, label: v.label, unit: v.unit,
        before: prev.value, after: v.value, delta,
        // Un milímetro arriba o abajo es ruido de marcado, no un cambio real.
        significant: Math.abs(delta) >= (v.unit === '°' ? 0.5 : 2),
      };
    });
}
