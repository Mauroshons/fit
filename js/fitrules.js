// Reglas de interpretación para bicicleta de ruta.
// Los rangos provienen de la práctica habitual del bikefit dinámico
// (Steve Hogg / Retül / Guru), adaptados por perfil de uso. Son referencias
// de trabajo, no verdades absolutas: siempre manda la comodidad del ciclista.

export const PROFILES = {
  granfondo: {
    label: 'Gran fondo / confort',
    torso: [45, 58],
    hipMin: [45, 58],
    elbow: [150, 170],
    shoulder: [78, 92],
  },
  endurance: {
    label: 'Endurance / rodador',
    torso: [40, 50],
    hipMin: [42, 52],
    elbow: [150, 165],
    shoulder: [80, 95],
  },
  race: {
    label: 'Competición / agresivo',
    torso: [32, 44],
    hipMin: [38, 48],
    elbow: [145, 160],
    shoulder: [85, 100],
  },
};

// Rangos comunes a todos los perfiles.
const COMMON = {
  kneeExtension: [140, 148],   // ángulo rodilla en punto muerto inferior
  kneeFlexion: [68, 78],       // ángulo rodilla en punto muerto superior
  ankleAtBdc: [95, 118],       // tobillo extendido abajo
  ankleRom: [12, 32],          // recorrido de tobillo en el ciclo
  kopsMm: [-15, 15],           // rodilla vs eje de pedal (+ = adelantada)
  kneeDev: [-6, 6],            // desviación frontal de rodilla (% ancho hombros)
  tilt: [0, 3],                // desnivel hombros / caderas
};

export function targetsFor(profileKey) {
  const p = PROFILES[profileKey] ?? PROFILES.endurance;
  return { ...COMMON, torso: p.torso, hipMin: p.hipMin, elbow: p.elbow, shoulder: p.shoulder };
}

const MM_PER_DEG_SADDLE = 2.5;   // ~1° de rodilla ≈ 2.5 mm de tija
const MM_PER_DEG_REACH = 2.0;    // ~1° de codo ≈ 2 mm de alcance

// Topes de lo que admite la bici. Si el cálculo los supera, el problema casi
// nunca es el ajuste fino: o el encuadre está mal o la talla no es la correcta.
const LIMITS = {
  saddleHeight: 25,   // mm por sesión; más que esto se hace en varias tandas
  saddleSetback: 30,  // recorrido típico de raíles
  reach: 30,          // 3 pasos de potencia
};

/** Recorta a un máximo razonable y avisa si hubo recorte. */
function capped(mm, limit) {
  const v = Math.min(Math.abs(mm), limit);
  return { mm: Math.round(v / 5) * 5, clamped: Math.abs(mm) > limit + 2 };
}

function status(value, [lo, hi]) {
  if (!Number.isFinite(value)) return 'na';
  if (value < lo) return 'low';
  if (value > hi) return 'high';
  return 'ok';
}

function round5(x) {
  return Math.round(x / 5) * 5;
}

/**
 * Convierte el resumen de ciclos en métricas evaluadas + recomendaciones.
 * @param {object} summary  salida de PedalCycleTracker.summary()
 * @param {object} opts     { profile, crankLengthMm, mmPerPx, frontal }
 */
export function evaluate(summary, opts = {}) {
  const t = targetsFor(opts.profile ?? 'endurance');
  const mmPerPx = opts.mmPerPx;
  const kopsMm = Number.isFinite(summary.kopsPx) && mmPerPx ? summary.kopsPx * mmPerPx : NaN;

  const metrics = opts.frontalOnly ? [] : [
    {
      key: 'kneeExtension',
      label: 'Extensión de rodilla (PMI)',
      value: summary.kneeExtension,
      unit: '°',
      range: t.kneeExtension,
      hint: 'Pierna más estirada del ciclo. Es el indicador principal de altura de sillín.',
    },
    {
      key: 'kneeFlexion',
      label: 'Flexión de rodilla (PMS)',
      value: summary.kneeFlexion,
      unit: '°',
      range: t.kneeFlexion,
      hint: 'Pierna más recogida. Si es muy cerrada, revisa biela larga o sillín bajo/adelantado.',
    },
    {
      key: 'hipMin',
      label: 'Ángulo de cadera (mín.)',
      value: summary.hipMin,
      unit: '°',
      range: t.hipMin,
      hint: 'Apertura torso-muslo en el punto más cerrado. Muy cerrado = pinzamiento y pérdida de potencia.',
    },
    {
      key: 'torso',
      label: 'Inclinación de torso',
      value: summary.torso,
      unit: '°',
      range: t.torso,
      hint: 'Respecto a la horizontal. Más bajo = más aerodinámico y más exigente de movilidad.',
    },
    {
      key: 'elbow',
      label: 'Ángulo de codo',
      value: summary.elbow,
      unit: '°',
      range: t.elbow,
      hint: 'Un codo casi bloqueado indica alcance excesivo; muy flexionado, manillar demasiado cerca.',
    },
    {
      key: 'shoulder',
      label: 'Ángulo de hombro',
      value: summary.shoulder,
      unit: '°',
      range: t.shoulder,
      hint: 'Entre tronco y brazo. Valores altos cargan cuello y trapecio.',
    },
    {
      key: 'ankleAtBdc',
      label: 'Tobillo en PMI',
      value: summary.ankleAtBdc,
      unit: '°',
      range: t.ankleAtBdc,
      hint: 'Mucha extensión plantar abajo suele acompañar a un sillín alto.',
    },
    {
      key: 'ankleRom',
      label: 'Recorrido de tobillo',
      value: summary.ankleRom,
      unit: '°',
      range: t.ankleRom,
      hint: 'Un tobillo que apenas se mueve o que "bombea" en exceso señala calado o altura a revisar.',
    },
  ];

  if (!opts.frontalOnly && Number.isFinite(kopsMm)) {
    metrics.push({
      key: 'kops',
      label: 'KOPS (rodilla vs eje de pedal)',
      value: kopsMm,
      unit: ' mm',
      range: t.kopsMm,
      hint: 'Medido con biela horizontal adelantada. Positivo = rodilla por delante del eje.',
    });
  }

  if (opts.frontal) {
    metrics.push(
      { key: 'kneeDevL', label: 'Desviación rodilla izq.', value: opts.frontal.kneeDevL, unit: ' %', range: t.kneeDev,
        hint: 'Positivo = rodilla hacia dentro (valgo). Revisa calas, cuñas o ancho de Q-factor.' },
      { key: 'kneeDevR', label: 'Desviación rodilla der.', value: opts.frontal.kneeDevR, unit: ' %', range: t.kneeDev,
        hint: 'Positivo = rodilla hacia dentro (valgo).' },
      { key: 'hipTilt', label: 'Desnivel de caderas', value: opts.frontal.hipTilt, unit: '°', range: t.tilt,
        hint: 'Balanceo o caída pélvica: posible sillín alto o dismetría.' },
      { key: 'shoulderTilt', label: 'Desnivel de hombros', value: opts.frontal.shoulderTilt, unit: '°', range: t.tilt,
        hint: 'Asimetría de apoyo en el manillar.' },
    );
  }

  for (const m of metrics) m.status = status(m.value, m.range);

  return { metrics, recommendations: buildRecommendations(metrics, summary, opts) };
}

function buildRecommendations(metrics, summary, opts) {
  const by = Object.fromEntries(metrics.map((m) => [m.key, m]));
  const recs = [];
  const mmPerPx = opts.mmPerPx;

  const add = (r) => recs.push(r);

  // --- Altura de sillín ---
  const ke = by.kneeExtension;
  if (ke && ke.status !== 'ok' && ke.status !== 'na') {
    const target = ke.status === 'low' ? ke.range[0] : ke.range[1];
    const deltaDeg = target - ke.value;
    const { mm, clamped } = capped(deltaDeg * MM_PER_DEG_SADDLE, LIMITS.saddleHeight);
    add({
      area: 'Sillín · altura',
      priority: Math.abs(deltaDeg) > 6 ? 'alta' : 'media',
      action: `${deltaDeg > 0 ? 'Subir' : 'Bajar'} el sillín ${mm || 3} mm (estimado)`,
      why: ke.status === 'low'
        ? `La rodilla queda demasiado flexionada abajo (${ke.value.toFixed(0)}°, objetivo ${ke.range[0]}–${ke.range[1]}°): sobrecarga de cuádriceps y rótula.`
        : `La pierna se estira en exceso (${ke.value.toFixed(0)}°, objetivo ${ke.range[0]}–${ke.range[1]}°): riesgo de balanceo de cadera y molestia posterior de rodilla.`,
      note: clamped
        ? `El cálculo pedía ${Math.abs(round5(deltaDeg * MM_PER_DEG_SADDLE))} mm: demasiado para un solo ajuste. Mueve ${mm} mm, rueda y vuelve a medir; si sigue fuera de rango, revisa el encuadre o la talla del cuadro.`
        : 'Mueve en pasos de 3–5 mm y rueda 15–20 min entre ajustes.',
    });
  } else if (ke?.status === 'ok') {
    add({ area: 'Sillín · altura', priority: 'ok', action: 'Mantener la altura actual',
      why: `Extensión de rodilla en ${ke.value.toFixed(0)}°, dentro del rango objetivo.`, note: '' });
  }

  if (Number.isFinite(summary.kneeExtensionSd) && summary.kneeExtensionSd > 4) {
    add({
      area: 'Técnica · estabilidad',
      priority: 'media',
      action: 'Revisar estabilidad pélvica y repetir la medición',
      why: `La extensión de rodilla varía ±${summary.kneeExtensionSd.toFixed(1)}° entre pedaladas: puede ser balanceo de cadera, sillín alto o simplemente ruido de detección.`,
      note: 'Si el balanceo es real, baja 5 mm el sillín y vuelve a medir.',
    });
  }

  // --- Retroceso de sillín ---
  const kops = by.kops;
  if (kops && kops.status !== 'ok' && kops.status !== 'na') {
    const target = kops.status === 'low' ? kops.range[0] : kops.range[1];
    const raw = kops.value - target;
    const { mm, clamped } = capped(raw, LIMITS.saddleSetback);
    add({
      area: 'Sillín · retroceso',
      priority: mm >= 20 ? 'alta' : 'media',
      action: `${raw > 0 ? 'Atrasar' : 'Adelantar'} el sillín ${mm || 5} mm (estimado)`,
      why: kops.status === 'high'
        ? `La rodilla cae ${kops.value.toFixed(0)} mm por delante del eje del pedal: carga anterior de rodilla.`
        : `La rodilla queda ${Math.abs(kops.value).toFixed(0)} mm por detrás del eje: posición muy retrasada, carga isquiotibial y poca punta.`,
      note: clamped
        ? `El desfase medido (${Math.abs(round5(raw))} mm) excede el recorrido de unos raíles. Antes de dar por buena la cifra, comprueba que la cámara esté perpendicular y centrada en el pedalier: un encuadre girado dispara esta medida.`
        : 'Tras mover el sillín horizontalmente, recomprueba la altura (el eje del tubo no es vertical).',
    });
  }

  // --- Alcance: potencia / manillar ---
  const el = by.elbow, sh = by.shoulder;
  if (el && el.status !== 'ok' && el.status !== 'na') {
    const target = el.status === 'low' ? el.range[0] : el.range[1];
    const raw = Math.abs(el.value - target) * MM_PER_DEG_REACH;
    const { mm: capMm, clamped } = capped(raw, LIMITS.reach);
    const mm = Math.max(10, capMm);
    const shorten = el.status === 'high'; // codo demasiado extendido => acortar
    add({
      area: 'Cockpit · alcance',
      priority: mm >= 20 ? 'alta' : 'media',
      action: `${shorten ? 'Acortar' : 'Alargar'} la potencia ~${mm} mm (estimado)`,
      why: shorten
        ? `Codo casi bloqueado (${el.value.toFixed(0)}°): el manillar queda lejos, se pierde amortiguación y cargan manos y lumbares.`
        : `Codo muy flexionado (${el.value.toFixed(0)}°): posición apelotonada, respiración y manejo comprometidos.`,
      note: clamped
        ? `El cálculo pedía ${round5(raw)} mm de cambio: con esa diferencia la talla del cuadro entra en cuestión. Prueba primero 30 mm y revalúa.`
        : 'Las potencias vienen en pasos de 10 mm. Antes de comprarla, prueba moviendo el sillín o rotando el manillar.',
    });
  }
  if (sh && sh.status === 'high') {
    add({
      area: 'Cockpit · altura',
      priority: 'media',
      action: 'Subir el manillar 5–10 mm (espaciadores) o reducir la caída',
      why: `Ángulo de hombro de ${sh.value.toFixed(0)}°: demasiado peso sobre las manos y tensión cervical.`,
      note: '',
    });
  }

  // --- Torso / caída de manillar ---
  const to = by.torso;
  if (to && to.status !== 'ok' && to.status !== 'na') {
    const tooLow = to.status === 'low';
    add({
      area: 'Cockpit · caída',
      priority: 'media',
      action: tooLow ? 'Reducir la caída: añadir 5–10 mm de espaciadores' : 'Se puede bajar el manillar 5–10 mm',
      why: tooLow
        ? `Torso a ${to.value.toFixed(0)}° de la horizontal, más agresivo que el objetivo del perfil (${to.range[0]}–${to.range[1]}°).`
        : `Torso a ${to.value.toFixed(0)}°, más erguido que el objetivo del perfil (${to.range[0]}–${to.range[1]}°): hay margen aerodinámico.`,
      note: 'Solo baja el manillar si la cadera no se cierra por debajo del rango y la espalda aguanta.',
    });
  }

  // --- Cadera cerrada ---
  const hip = by.hipMin;
  if (hip?.status === 'low') {
    add({
      area: 'Cadera',
      priority: 'alta',
      action: 'Abrir la cadera: manillar más alto, sillín algo atrasado o punta -1/-2°',
      why: `Apertura mínima de cadera de ${hip.value.toFixed(0)}° (objetivo ${hip.range[0]}–${hip.range[1]}°): pinzamiento femoroacetabular y pérdida de potencia arriba.`,
      note: 'También revisa movilidad de isquiotibiales y flexores: a veces el problema es el ciclista, no la bici.',
    });
  }

  // --- Tobillo ---
  const ank = by.ankleAtBdc;
  if (ank?.status === 'high') {
    add({
      area: 'Pie y calas',
      priority: 'media',
      action: 'Retrasar las calas 2–3 mm y recomprobar la altura de sillín',
      why: `El tobillo se extiende hasta ${ank.value.toFixed(0)}° en el punto muerto inferior: suele indicar sillín alto o cala muy adelantada.`,
      note: '',
    });
  }
  if (by.ankleRom?.status === 'low') {
    add({
      area: 'Pie y calas',
      priority: 'baja',
      action: 'Revisar movilidad de tobillo y rigidez de la zapatilla',
      why: `Recorrido de tobillo de solo ${by.ankleRom.value.toFixed(0)}°: pedaleo muy "bloqueado".`,
      note: '',
    });
  }

  // --- Frontal ---
  for (const k of ['kneeDevL', 'kneeDevR']) {
    const m = by[k];
    if (m && m.status !== 'ok' && m.status !== 'na') {
      const lado = k.endsWith('L') ? 'izquierda' : 'derecha';
      add({
        area: `Tracking rodilla ${lado}`,
        priority: 'media',
        action: m.status === 'high'
          ? 'Valorar cuña interna, cala más hacia fuera o espaciador de pedal'
          : 'Valorar reducir el Q-factor / acercar la cala al eje',
        why: `La rodilla ${lado} se desvía ${m.value.toFixed(1)}% del ancho de hombros respecto a la línea cadera-tobillo.`,
        note: 'El tracking se corrige con calas y soporte plantar, no con el sillín.',
      });
    }
  }
  if (by.hipTilt && by.hipTilt.status !== 'ok' && by.hipTilt.status !== 'na') {
    add({
      area: 'Pelvis',
      priority: 'media',
      action: 'Bajar 5 mm el sillín y descartar dismetría de piernas',
      why: `Desnivel de caderas de ${by.hipTilt.value.toFixed(1)}° durante el pedaleo.`,
      note: '',
    });
  }

  // --- Cadencia de la prueba ---
  if (Number.isFinite(summary.cadence) && (summary.cadence < 70 || summary.cadence > 100)) {
    add({
      area: 'Protocolo',
      priority: 'baja',
      action: 'Repetir midiendo a 85–95 rpm',
      why: `Cadencia medida: ${summary.cadence.toFixed(0)} rpm. Fuera de ese rango los ángulos dejan de ser comparables con las referencias.`,
      note: '',
    });
  }

  if (!mmPerPx && !opts.frontalOnly) {
    add({
      area: 'Calibración',
      priority: 'baja',
      action: 'Calibrar la escala para obtener milímetros',
      why: 'No se pudo estimar la escala px→mm (trayectoria del pie poco visible), así que KOPS y los ajustes en mm son aproximados.',
      note: 'Encuadra la bici completa de lado, cámara a la altura del pedalier y perpendicular al plano de la bici.',
    });
  }

  const order = { alta: 0, media: 1, baja: 2, ok: 3 };
  return recs.sort((a, b) => order[a.priority] - order[b.priority]);
}
