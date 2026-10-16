// Orquestación de la app: cámara, inferencia de pose, overlay y UI.

import {
  FilesetResolver, PoseLandmarker,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

import { EMA, median } from './geometry.js';
import {
  LM, SKELETON, MIN_VIS, pickSide, sidePoints, frameMetricsSagittal, frameMetricsFrontal,
  PedalCycleTracker, pxToMm,
} from './analyzer.js';
import { evaluate } from './fitrules.js';
import { POINTS, computeMeasures, diffMeasures } from './measure.js';

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

// Tres pesos del mismo modelo. En un móvil el "alto" es inviable y el "ligero"
// paga con ruido en los centros articulares, que es justo lo que medimos.
const MODELS = {
  lite: { label: 'ligero', mb: 5, url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task' },
  full: { label: 'estándar', mb: 9, url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task' },
  heavy: { label: 'alto', mb: 29, url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task' },
};

const $ = (id) => document.getElementById(id);
const el = {
  video: $('video'), overlay: $('overlay'), stage: $('stage'), stageMsg: $('stageMsg'),
  engineState: $('engineState'), recBadge: $('recBadge'),
  hudSide: $('hudSide'), hudFps: $('hudFps'), hudCycles: $('hudCycles'), hudCadence: $('hudCadence'),
  btnCamera: $('btnCamera'), btnRecord: $('btnRecord'), btnSnapshot: $('btnSnapshot'),
  cameraSelect: $('cameraSelect'),
  riderName: $('riderName'), viewMode: $('viewMode'), profile: $('profile'),
  sideSelect: $('sideSelect'), crankLength: $('crankLength'), inseam: $('inseam'),
  duration: $('duration'), mirror: $('mirror'), estimates: $('estimates'),
  modelQuality: $('modelQuality'),
  liveMetrics: $('liveMetrics'), livePlaceholder: $('livePlaceholder'),
  visibility: $('visibility'),
  report: $('report'), reportPlaceholder: $('reportPlaceholder'),
  reportMetrics: $('reportMetrics'), reportRecs: $('reportRecs'),
  reportTitle: $('reportTitle'), reportMeta: $('reportMeta'),
  btnExport: $('btnExport'), btnPrint: $('btnPrint'),
  btnFreeze: $('btnFreeze'), btnUndoPoint: $('btnUndoPoint'), btnClearPoints: $('btnClearPoints'),
  measurePrompt: $('measurePrompt'), measureResults: $('measureResults'),
  measureValues: $('measureValues'), measurePrecision: $('measurePrecision'),
  fichaName: $('fichaName'), btnSaveFicha: $('btnSaveFicha'),
  fichasBox: $('fichasBox'), fichasList: $('fichasList'), fichaDiff: $('fichaDiff'),
};

const state = {
  landmarker: null,
  stream: null,
  running: false,
  recording: false,
  recordUntil: 0,
  lastVideoTime: -1,
  smoother: new EMA(0.45),
  tracker: new PedalCycleTracker(),
  frontalSamples: [],
  side: 'right',
  fps: { last: performance.now(), frames: 0, value: 0 },
  lastReport: null,
  modelKey: 'full',
  delegate: null,
  // Medición de cotas sobre fotograma congelado.
  frozen: false,
  points: {},
  measures: null,
  fichas: [],
  baseline: null,
};

/* ============================ Motor de pose ============================ */

/** Heurística de dispositivo para elegir el peso por defecto del modelo. */
function defaultModelKey() {
  const fromUrl = new URLSearchParams(location.search).get('model');
  if (MODELS[fromUrl]) return fromUrl;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 820;
  return coarse && small ? 'lite' : 'full';
}

let fileset = null;

async function initEngine(key = state.modelKey) {
  state.modelKey = key;
  const model = MODELS[key];
  // Soltamos el anterior antes de cargar: el bucle no debe tocar un
  // landmarker a medio cerrar.
  const previous = state.landmarker;
  state.landmarker = null;
  previous?.close();

  setEngine('wait', `Cargando modelo ${model.label} (~${model.mb} MB)…`);
  el.btnCamera.disabled = true;
  try {
    fileset ??= await FilesetResolver.forVisionTasks(WASM_BASE);
    const options = {
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    };
    // Safari en iOS/iPadOS falla a veces al inicializar el delegado GPU según
    // la versión de WebKit. Si pasa, seguimos por CPU en vez de morir.
    try {
      state.landmarker = await PoseLandmarker.createFromOptions(fileset, {
        ...options, baseOptions: { modelAssetPath: model.url, delegate: 'GPU' },
      });
      state.delegate = 'GPU';
    } catch (gpuErr) {
      console.warn('Delegado GPU no disponible, reintentando por CPU:', gpuErr);
      state.landmarker = await PoseLandmarker.createFromOptions(fileset, {
        ...options, baseOptions: { modelAssetPath: model.url, delegate: 'CPU' },
      });
      state.delegate = 'CPU';
    }
    setEngine('ok', `Modelo ${model.label} listo${state.delegate === 'CPU' ? ' (CPU)' : ''}`);
    el.btnCamera.disabled = false;
  } catch (err) {
    console.error(err);
    setEngine('bad', 'Error cargando el modelo');
    showStageError(
      'No se pudo cargar el modelo de pose',
      `Se descarga desde el CDN de Google (~${model.mb} MB) y luego queda en caché. Revisa la conexión; si estás en una red corporativa puede estar bloqueado <code>storage.googleapis.com</code>.`,
      await collectDiagnostics(), err);
  }
}

function setEngine(kind, text) {
  el.engineState.className = `pill pill-${kind === 'ok' ? 'ok' : kind === 'bad' ? 'bad' : 'wait'}`;
  el.engineState.textContent = text;
}

/* ============================== Cámara ============================== */

async function listCameras() {
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices())
      .filter((d) => d.kind === 'videoinput');
    if (devices.length < 2) return;
    el.cameraSelect.hidden = false;
    el.cameraSelect.innerHTML = devices
      .map((d, i) => `<option value="${d.deviceId}">${d.label || `Cámara ${i + 1}`}</option>`)
      .join('');
    if (state.stream) {
      const id = state.stream.getVideoTracks()[0].getSettings().deviceId;
      if (id) el.cameraSelect.value = id;
    }
  } catch { /* enumerateDevices puede fallar sin permisos */ }
}

/** Reúne el contexto que hace falta para explicar un fallo de cámara. */
async function collectDiagnostics() {
  const d = {
    protocolo: location.protocol,
    origen: location.host || '(sin host)',
    'contexto seguro': window.isSecureContext ? 'sí' : 'NO',
    'API mediaDevices': navigator.mediaDevices?.getUserMedia ? 'disponible' : 'NO DISPONIBLE',
    'dentro de iframe': window.self !== window.top ? 'SÍ' : 'no',
  };
  try {
    const st = await navigator.permissions?.query({ name: 'camera' });
    if (st) d['permiso de cámara'] = st.state;
  } catch { /* Firefox no soporta la consulta del permiso de cámara */ }
  try {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((x) => x.kind === 'videoinput');
    d['cámaras detectadas'] = cams.length
      ? cams.map((c, i) => c.label || `cámara ${i + 1} (sin permiso para leer el nombre)`).join(', ')
      : 'ninguna';
  } catch (e) {
    d['cámaras detectadas'] = `error al enumerar (${e.name})`;
  }
  return d;
}

/** Traduce el error de getUserMedia a una causa y una acción concretas. */
function describeError(err, diag) {
  const inIframe = diag['dentro de iframe'] === 'SÍ';
  switch (err?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return inIframe
        ? ['Permiso bloqueado por el contenedor',
           'La página está incrustada en un <strong>iframe sin permiso de cámara</strong>. Ábrela en una pestaña normal del navegador: <code>http://localhost:5173</code>.']
        : ['Permiso denegado',
           'Has bloqueado la cámara para este sitio. Pulsa el <strong>candado</strong> (o el icono de cámara tachada) en la barra de direcciones, permite la cámara y recarga la página.'];
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return ['No hay ninguna cámara',
              'El navegador no encuentra dispositivos de vídeo. Comprueba que la webcam esté conectada y habilitada en el sistema.'];
    case 'NotReadableError':
    case 'TrackStartError':
      return ['La cámara está ocupada',
              'Otra aplicación la está usando (Teams, Zoom, Meet, Cámara de Windows…) o el driver falló. Ciérralas y vuelve a intentarlo.'];
    case 'OverconstrainedError':
      return ['La cámara no admite lo pedido',
              `Falló la restricción <code>${err.constraint || 'desconocida'}</code>. Prueba a elegir otra cámara en el selector.`];
    case 'SecurityError':
      return ['Bloqueado por seguridad',
              'El navegador solo da acceso a la cámara en <code>localhost</code> o <code>https</code>.'];
    default:
      return ['No se pudo abrir la cámara', 'Revisa el detalle técnico de abajo.'];
  }
}

function showStageError(title, body, diag, err) {
  const rows = Object.entries(diag).map(([k, v]) => `<li><span>${k}</span><b>${v}</b></li>`).join('');
  el.stageMsg.hidden = false;
  el.stageMsg.innerHTML = `
    <div class="err-box">
      <h2>${title}</h2>
      <p>${body}</p>
      ${err ? `<p class="err-tech"><code>${err.name}: ${err.message || 'sin mensaje'}</code></p>` : ''}
      <ul class="diag">${rows}</ul>
    </div>`;
}

async function startCamera(deviceId) {
  const diag = await collectDiagnostics();

  if (!navigator.mediaDevices?.getUserMedia) {
    showStageError(
      'Este navegador no expone la cámara',
      window.isSecureContext
        ? 'La API <code>mediaDevices</code> no está disponible. Usa Chrome, Edge, Firefox o Safari actualizados.'
        : 'Has abierto la página sin contexto seguro (probablemente con <code>file://</code>). Arranca el servidor con <code>node server.mjs</code> y entra por <code>http://localhost:5173</code>.',
      diag, null);
    return;
  }

  stopCamera();

  // De lo más específico a lo más permisivo: si la cámara no acepta 1280x720
  // o no hay cámara trasera, seguimos intentándolo en vez de fallar.
  const attempts = [
    deviceId && { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    { width: { ideal: 1280 }, height: { ideal: 720 } },
    true,
  ].filter(Boolean);

  let lastErr = null;
  for (const video of attempts) {
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      // Si el usuario deniega el permiso, reintentar no cambia nada.
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') break;
    }
  }

  if (lastErr) {
    console.error('getUserMedia falló:', lastErr);
    const [title, body] = describeError(lastErr, diag);
    showStageError(title, body, await collectDiagnostics(), lastErr);
    return;
  }

  try {
    el.video.srcObject = state.stream;
    await el.video.play();
    el.stageMsg.hidden = true;
    el.btnCamera.textContent = 'Apagar cámara';
    el.btnRecord.disabled = false;
    el.btnSnapshot.disabled = false;
    el.btnFreeze.disabled = false;
    el.livePlaceholder.hidden = true;
    state.running = true;
    state.smoother.reset();
    state.tracker.reset();
    await listCameras();
    requestAnimationFrame(loop);
  } catch (err) {
    // El stream se obtuvo pero el <video> no arrancó (autoplay, códec, etc.).
    console.error('No arrancó la reproducción:', err);
    showStageError(
      'La cámara se abrió pero el vídeo no arranca',
      'El navegador concedió el stream pero bloqueó la reproducción. Vuelve a pulsar <strong>Activar cámara</strong>; si persiste, recarga la página.',
      await collectDiagnostics(), err);
    stopCamera();
  }
}

// El cartel del escenario se reescribe con paneles de error; guardamos el
// contenido original para poder restaurarlo al apagar la cámara.
const STAGE_MSG_DEFAULT = el.stageMsg.innerHTML;

function stopCamera() {
  state.running = false;
  stopRecording(false);
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
  el.video.srcObject = null;
  el.btnCamera.textContent = 'Activar cámara';
  el.btnRecord.disabled = true;
  el.btnSnapshot.disabled = true;
  el.btnFreeze.disabled = true;
  // Los marcadores se refieren a un fotograma que ya no existe.
  state.frozen = false;
  state.points = {};
  state.measures = null;
  el.stage.classList.remove('measuring');
  el.btnFreeze.textContent = 'Congelar imagen';
  el.measurePrompt.hidden = true;
  el.measureResults.hidden = true;
  el.stageMsg.innerHTML = STAGE_MSG_DEFAULT;
  el.stageMsg.hidden = false;
  const ctx = el.overlay.getContext('2d');
  ctx.clearRect(0, 0, el.overlay.width, el.overlay.height);
}

/* ============================ Bucle principal ============================ */

function loop() {
  if (!state.running) return;
  const v = el.video;

  // Con la imagen congelada el overlay pertenece a los marcadores de cotas:
  // seguir detectando lo borraría en cada frame.
  if (state.frozen) {
    requestAnimationFrame(loop);
    return;
  }

  if (state.landmarker && v.readyState >= 2 && v.videoWidth) {
    if (el.overlay.width !== v.videoWidth) {
      el.overlay.width = v.videoWidth;
      el.overlay.height = v.videoHeight;
    }
    if (v.currentTime !== state.lastVideoTime) {
      state.lastVideoTime = v.currentTime;
      const result = state.landmarker.detectForVideo(v, performance.now());
      processResult(result, v.videoWidth, v.videoHeight);
    }
    tickFps();
  }
  requestAnimationFrame(loop);
}

function tickFps() {
  const f = state.fps;
  f.frames++;
  const now = performance.now();
  if (now - f.last >= 500) {
    f.value = Math.round((f.frames * 1000) / (now - f.last));
    f.frames = 0;
    f.last = now;
    el.hudFps.textContent = `${f.value} fps`;
  }
}

function processResult(result, w, h) {
  const raw = result?.landmarks?.[0];
  const ctx = el.overlay.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  if (!raw) {
    el.hudSide.textContent = 'Sin detección';
    return;
  }

  const lms = state.smoother.push(raw);
  const frontalMode = el.viewMode.value === 'frontal';

  if (frontalMode) {
    const fm = frameMetricsFrontal(lms, w, h);
    drawSkeleton(ctx, lms, w, h, null);
    el.hudSide.textContent = 'Vista frontal';
    renderLive([
      { label: 'Desv. rodilla izq.', value: fm.kneeDevL, unit: ' %' },
      { label: 'Desv. rodilla der.', value: fm.kneeDevR, unit: ' %' },
      { label: 'Desnivel caderas', value: fm.hipTilt, unit: '°' },
      { label: 'Desnivel hombros', value: fm.shoulderTilt, unit: '°' },
    ]);
    if (state.recording) {
      state.frontalSamples.push(fm);
      // La cadencia en frontal no es fiable; mostramos solo el conteo de frames.
      el.hudCycles.textContent = `${state.frontalSamples.length} frames`;
      if (performance.now() >= state.recordUntil) stopRecording(true);
    }
    return;
  }

  // --- Vista sagital ---
  state.side = pickSide(lms, el.sideSelect.value);
  const p = sidePoints(lms, state.side, w, h);
  const m = frameMetricsSagittal(p);

  drawSkeleton(ctx, lms, w, h, state.side);
  drawAngles(ctx, p, m);

  el.hudSide.textContent = `Lado: ${state.side === 'right' ? 'derecho' : 'izquierdo'}`;
  renderLive([
    { label: 'Rodilla', value: m.knee, unit: '°' },
    { label: 'Cadera', value: m.hip, unit: '°' },
    { label: 'Torso', value: m.torso, unit: '°' },
    { label: 'Codo', value: m.elbow, unit: '°' },
    { label: 'Hombro', value: m.shoulder, unit: '°' },
    { label: 'Tobillo', value: m.ankle, unit: '°' },
  ]);
  renderVisibility(m.vis);

  if (state.recording) {
    state.tracker.push(performance.now(), m, p);
    const s = state.tracker.summary();
    el.hudCycles.textContent = `${state.tracker.cycles.length} pedaladas`;
    el.hudCadence.textContent = s && Number.isFinite(s.cadence) ? `${s.cadence.toFixed(0)} rpm` : '— rpm';
    if (performance.now() >= state.recordUntil) stopRecording(true);
  }
}

/* ============================== Dibujo ============================== */

const COLORS = {
  active: '#35d07f',
  dim: 'rgba(160,185,210,.38)',
  text: '#eaf4ff',
  unsure: '#f0b429',   // visible para el modelo, pero por debajo del umbral
};

function drawSkeleton(ctx, lms, w, h, side) {
  const S = side === 'right' ? 'R' : side === 'left' ? 'L' : null;
  const vis = (pt) => pt?.visibility ?? 1;
  ctx.lineWidth = Math.max(2, w / 420);

  for (const [a, b] of SKELETON) {
    const onSide = S && a.endsWith(S) && b.endsWith(S);
    const pa = lms[LM[a]], pb = lms[LM[b]];
    if (!pa || !pb) continue;
    // Un tramo que cuelga de un punto poco fiable se dibuja punteado: así se
    // ve de un vistazo que ese ángulo no se está midiendo.
    const weak = (!S || onSide) && Math.min(vis(pa), vis(pb)) < MIN_VIS;
    ctx.save();
    if (weak) ctx.setLineDash([5, 5]);
    ctx.strokeStyle = !S || onSide ? (weak ? COLORS.unsure : COLORS.active) : COLORS.dim;
    ctx.beginPath();
    ctx.moveTo(pa.x * w, pa.y * h);
    ctx.lineTo(pb.x * w, pb.y * h);
    ctx.stroke();
    ctx.restore();
  }

  const r = Math.max(3, w / 300);
  for (const name of Object.keys(LM)) {
    const pt = lms[LM[name]];
    if (!pt) continue;
    const onSide = S && name.endsWith(S);
    // Antes los puntos flojos simplemente no se pintaban, así que una muñeca
    // sin detectar era indistinguible de una ausente. Ahora sale hueca.
    if (vis(pt) < MIN_VIS) {
      if (!S || onSide) {
        ctx.strokeStyle = COLORS.unsure;
        ctx.lineWidth = Math.max(1.5, w / 600);
        ctx.beginPath();
        ctx.arc(pt.x * w, pt.y * h, r * 1.25, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = Math.max(2, w / 420);
      }
      continue;
    }
    ctx.fillStyle = !S || onSide ? COLORS.active : COLORS.dim;
    ctx.beginPath();
    ctx.arc(pt.x * w, pt.y * h, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawAngles(ctx, p, m) {
  const fontSize = Math.max(13, el.overlay.width / 60);
  ctx.font = `600 ${fontSize}px ${getComputedStyle(document.body).fontFamily}`;
  ctx.textBaseline = 'middle';

  const labels = [
    [p.knee, m.knee, 'rodilla'],
    [p.hip, m.hip, 'cadera'],
    [p.elbow, m.elbow, 'codo'],
    [p.shoulder, m.shoulder, 'hombro'],
    [p.ankle, m.ankle, 'tobillo'],
  ];

  for (const [pt, val, name] of labels) {
    if (!Number.isFinite(val)) continue;
    const text = `${Math.round(val)}° ${name}`;
    const tw = ctx.measureText(text).width;
    const x = pt.x + fontSize * 0.8;
    const y = pt.y - fontSize * 0.8;
    ctx.fillStyle = 'rgba(5,10,16,.72)';
    ctx.fillRect(x - 4, y - fontSize * 0.75, tw + 8, fontSize * 1.5);
    ctx.fillStyle = COLORS.text;
    ctx.fillText(text, x, y);
  }

  // Línea de torso respecto a la horizontal.
  if (Number.isFinite(m.torso)) {
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = 'rgba(74,168,255,.8)';
    ctx.lineWidth = Math.max(1.5, el.overlay.width / 700);
    ctx.beginPath();
    ctx.moveTo(p.hip.x, p.hip.y);
    ctx.lineTo(p.hip.x + (p.shoulder.x - p.hip.x) * 1.15, p.hip.y);
    ctx.stroke();
    ctx.restore();
  }
}

/* ============================== UI: métricas ============================== */

function renderLive(items) {
  el.liveMetrics.innerHTML = items.map((i) => `
    <div class="metric ${Number.isFinite(i.value) ? 'ok' : 'na'}">
      <div class="m-label">${i.label}</div>
      <div class="m-value">${Number.isFinite(i.value) ? i.value.toFixed(0) + i.unit : '—'}</div>
    </div>`).join('');
}

const JOINT_NAMES = {
  shoulder: 'Hombro', elbow: 'Codo', wrist: 'Muñeca', hip: 'Cadera',
  knee: 'Rodilla', ankle: 'Tobillo', foot: 'Metatarso',
};

/** Barra de confianza por articulación: señala cuál no se está viendo. */
function renderVisibility(vis) {
  if (!vis) return;
  el.visibility.hidden = false;
  el.visibility.innerHTML = Object.entries(vis).map(([j, v]) => {
    const pct = Math.round((v ?? 0) * 100);
    const weak = (v ?? 0) < MIN_VIS;
    return `
      <li class="${weak ? 'weak' : ''}">
        <span>${JOINT_NAMES[j] ?? j}</span>
        <i><b style="width:${pct}%"></b></i>
        <em>${pct}%</em>
      </li>`;
  }).join('');
}

function renderMetrics(container, metrics) {
  container.innerHTML = metrics.map((m) => {
    const [lo, hi] = m.range;
    const span = (hi - lo) * 2.2 || 1;
    const axisLo = lo - span / 2.2, axisHi = hi + span / 2.2;
    const pct = (x) => `${Math.min(100, Math.max(0, ((x - axisLo) / (axisHi - axisLo)) * 100))}%`;
    const val = Number.isFinite(m.value);
    return `
      <div class="metric ${m.status}" data-hint="1" title="${m.hint}">
        <div class="m-label">${m.label}</div>
        <div class="m-value">${val ? m.value.toFixed(m.unit === ' mm' || m.unit === ' %' ? 1 : 0) + m.unit : '—'}</div>
        <div class="m-range">objetivo ${lo}–${hi}${m.unit}</div>
        ${val ? `<div class="bar">
            <div class="zone" style="left:${pct(lo)};right:calc(100% - ${pct(hi)})"></div>
            <div class="mark" style="left:${pct(m.value)}"></div>
          </div>` : ''}
        <div class="m-hint">${m.hint}</div>
      </div>`;
  }).join('');

  container.querySelectorAll('.metric[data-hint]').forEach((node) => {
    node.addEventListener('click', () => node.classList.toggle('expanded'));
  });
}

function renderRecs(container, recs) {
  if (!recs.length) {
    container.innerHTML = '<div class="placeholder">Sin recomendaciones: todo dentro de rango.</div>';
    return;
  }
  container.innerHTML = recs.map((r) => `
    <div class="rec ${r.priority}">
      <div class="rec-top">
        <span class="rec-area">${r.area}</span>
        <span class="rec-prio">${r.priority === 'ok' ? 'correcto' : `prioridad ${r.priority}`}</span>
      </div>
      <div class="rec-action">${r.action}</div>
      <div class="rec-why">${r.why}</div>
      ${r.note ? `<div class="rec-note">${r.note}</div>` : ''}
    </div>`).join('');
}

/* ============================== Medición ============================== */

function startRecording() {
  state.tracker.reset();
  state.frontalSamples = [];
  state.recording = true;
  state.recordUntil = performance.now() + Number(el.duration.value || 20) * 1000;
  el.recBadge.hidden = false;
  el.btnRecord.textContent = 'Detener';
  el.btnRecord.classList.remove('btn-accent');
  el.btnRecord.classList.add('btn-danger');
}

function stopRecording(buildReport) {
  if (!state.recording) return;
  state.recording = false;
  el.recBadge.hidden = true;
  el.btnRecord.textContent = 'Iniciar medición';
  el.btnRecord.classList.add('btn-accent');
  el.btnRecord.classList.remove('btn-danger');
  if (buildReport) makeReport();
}

function makeReport() {
  const frontalMode = el.viewMode.value === 'frontal';
  const crank = Number(el.crankLength.value || 172.5);

  let summary = null;
  let frontal = null;

  if (frontalMode) {
    if (state.frontalSamples.length < 30) return reportError('Muy pocos frames válidos. Repite la medición.');
    const col = (k) => state.frontalSamples.map((s) => s[k]);
    frontal = {
      kneeDevL: median(col('kneeDevL')),
      kneeDevR: median(col('kneeDevR')),
      hipTilt: median(col('hipTilt')),
      shoulderTilt: median(col('shoulderTilt')),
      headTilt: median(col('headTilt')),
    };
    summary = { cycles: 0, frames: state.frontalSamples.length };
  } else {
    summary = state.tracker.summary();
    if (!summary || summary.cycles < 3) {
      return reportError('No se detectaron suficientes pedaladas completas. Revisa el encuadre lateral y pedalea de forma continua.');
    }
  }

  const mmPerPx = frontalMode ? null : pxToMm(summary, crank);
  const { metrics, recommendations } = evaluate(summary, {
    profile: el.profile.value,
    crankLengthMm: crank,
    mmPerPx,
    frontal,
    frontalOnly: frontalMode,
  });

  const report = {
    generatedAt: new Date().toISOString(),
    rider: el.riderName.value || 'Sin nombre',
    view: frontalMode ? 'frontal' : 'sagital',
    side: frontalMode ? 'ambos' : state.side,
    profile: el.profile.value,
    crankLengthMm: crank,
    inseamCm: Number(el.inseam.value) || null,
    mmPerPx,
    summary,
    metrics,
    recommendations,
    // Cotas de la bici medidas en la pestaña Cotas, si las hay. Sin esto el
    // informe documenta la postura pero no la máquina que la produce.
    cotas: state.measures
      ? { scale: state.measures.scale, values: state.measures.values }
      : null,
    fichas: state.fichas,
  };
  state.lastReport = report;

  el.reportPlaceholder.hidden = true;
  el.report.hidden = false;
  el.reportTitle.textContent = `Informe de bikefit · ${report.rider}`;
  el.reportMeta.textContent = [
    new Date(report.generatedAt).toLocaleString('es-ES'),
    `vista ${report.view}`,
    frontalMode ? `${summary.frames} frames` : `${summary.cycles} pedaladas`,
    !frontalMode && Number.isFinite(summary.cadence) ? `${summary.cadence.toFixed(0)} rpm` : null,
    `perfil ${el.profile.options[el.profile.selectedIndex].text}`,
    mmPerPx ? `escala ${mmPerPx.toFixed(2)} mm/px` : 'sin calibración métrica',
  ].filter(Boolean).join(' · ');

  renderMetrics(el.reportMetrics, metrics);
  renderRecs(el.reportRecs, recommendations);
  selectTab('report');
}

function reportError(msg) {
  el.report.hidden = true;
  el.reportPlaceholder.hidden = false;
  el.reportPlaceholder.textContent = msg;
  selectTab('report');
}

/* ============================== Estimaciones ============================== */

function updateEstimates() {
  const inseam = Number(el.inseam.value);
  if (!inseam || inseam < 50) {
    el.estimates.hidden = true;
    return;
  }
  const cm = inseam;
  const lemond = cm * 0.883;             // pedalier -> parte alta del sillín
  const hamley = cm * 1.09;              // sillín -> pedal en PMI (con biela)
  const crank = Math.round((cm * 2.16) / 2.5) * 2.5; // ~21.6% de la entrepierna
  const reach = cm * 0.52;               // orientativo sillín -> manillar
  el.estimates.hidden = false;
  el.estimates.innerHTML = `
    <b>Punto de partida según entrepierna (${cm} cm)</b><br>
    Altura de sillín (LeMond, 0.883): <b>${lemond.toFixed(1)} cm</b><br>
    Altura sillín→pedal en PMI (Hamley, 1.09): <b>${hamley.toFixed(1)} cm</b><br>
    Biela sugerida: <b>${crank.toFixed(1)} mm</b><br>
    Alcance sillín→manillar orientativo: <b>${reach.toFixed(1)} cm</b><br>
    <span style="color:#7fc3a3">Son fórmulas de partida; manda siempre lo que midan los ángulos.</span>`;
}

/* ============================== Eventos ============================== */

function selectTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
}

document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => selectTab(t.dataset.tab));
});

el.btnCamera.addEventListener('click', () => {
  if (state.stream) stopCamera();
  else startCamera(el.cameraSelect.value || null);
});

el.btnRecord.addEventListener('click', () => {
  if (state.recording) stopRecording(true);
  else { startRecording(); selectTab('live'); }
});

el.btnSnapshot.addEventListener('click', () => {
  const c = document.createElement('canvas');
  c.width = el.video.videoWidth;
  c.height = el.video.videoHeight;
  const ctx = c.getContext('2d');
  if (el.mirror.checked) { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(el.video, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (el.mirror.checked) { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(el.overlay, 0, 0);
  const a = document.createElement('a');
  a.download = `bikefit-${Date.now()}.png`;
  a.href = c.toDataURL('image/png');
  a.click();
});

el.cameraSelect.addEventListener('change', () => startCamera(el.cameraSelect.value));
el.modelQuality.addEventListener('change', () => initEngine(el.modelQuality.value));

/* --- Cotas --- */
el.btnFreeze.addEventListener('click', () => setFrozen(!state.frozen));
el.btnUndoPoint.addEventListener('click', () => {
  const placed = POINTS.filter((p) => state.points[p.key]);
  if (placed.length) delete state.points[placed[placed.length - 1].key];
  renderMeasure();
});
el.btnClearPoints.addEventListener('click', () => { state.points = {}; renderMeasure(); });

// Ajuste fino del último punto marcado: un píxel de imagen por pulsación.
addEventListener('keydown', (ev) => {
  if (!state.frozen) return;
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
  if (!d) return;
  const placed = POINTS.filter((p) => state.points[p.key]);
  if (!placed.length) return;
  ev.preventDefault();
  const p = state.points[placed[placed.length - 1].key];
  const step = ev.shiftKey ? 5 : 1;
  p.x = Math.min(el.overlay.width, Math.max(0, p.x + d[0] * step));
  p.y = Math.min(el.overlay.height, Math.max(0, p.y + d[1] * step));
  renderMeasure();
});
el.stage.addEventListener('click', onStageClick);
el.crankLength.addEventListener('input', () => { if (state.frozen) renderMeasure(); });

el.btnSaveFicha.addEventListener('click', () => {
  if (!state.measures) return;
  const name = el.fichaName.value.trim() || `Ficha ${state.fichas.length + 1}`;
  // Copia profunda: guardar la referencia dejaría la ficha expuesta a los
  // recálculos posteriores de state.measures.
  state.fichas.push({
    name, at: Date.now(), scale: state.measures.scale,
    values: state.measures.values.map((v) => ({ ...v })),
  });
  saveFichas(state.fichas);
  el.fichaName.value = '';
  // La recién guardada pasa a ser la referencia solo si no había ninguna.
  if (state.baseline === null) state.baseline = state.fichas.length - 1;
  renderFichas();
});
el.mirror.addEventListener('change', () => el.stage.classList.toggle('mirrored', el.mirror.checked));
el.inseam.addEventListener('input', updateEstimates);
el.viewMode.addEventListener('change', () => {
  state.tracker.reset();
  state.frontalSamples = [];
  el.hudCadence.textContent = '— rpm';
  el.hudCycles.textContent = '0 pedaladas';
});

el.btnExport.addEventListener('click', () => {
  if (!state.lastReport) return;
  const blob = new Blob([JSON.stringify(state.lastReport, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bikefit-${(state.lastReport.rider || 'ciclista').replace(/\s+/g, '-').toLowerCase()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

el.btnPrint.addEventListener('click', () => window.print());

window.addEventListener('beforeunload', stopCamera);

/* ============================== Cotas de la bici ============================== */

/**
 * Traduce un clic del ratón/dedo a píxeles de la imagen.
 * El canvas se pinta con `object-fit: contain`, así que hay bandas vacías a los
 * lados o arriba; sin descontarlas, los puntos caerían desplazados.
 */
function eventToImagePoint(ev) {
  const box = el.overlay.getBoundingClientRect();
  const iw = el.overlay.width, ih = el.overlay.height;
  if (!iw || !ih) return null;

  const fit = Math.min(box.width / iw, box.height / ih);
  const shownW = iw * fit, shownH = ih * fit;
  const padX = (box.width - shownW) / 2, padY = (box.height - shownH) / 2;

  const touch = ev.touches?.[0] ?? ev.changedTouches?.[0] ?? ev;
  let x = (touch.clientX - box.left - padX) / fit;
  const y = (touch.clientY - box.top - padY) / fit;
  if (x < 0 || y < 0 || x > iw || y > ih) return null;   // clic en la banda vacía
  if (el.mirror.checked) x = iw - x;                      // el CSS invierte la X
  return { x, y };
}

function nextPointSpec() {
  return POINTS.find((p) => !state.points[p.key]) ?? null;
}

function onStageClick(ev) {
  if (!state.frozen) return;
  const spec = nextPointSpec();
  if (!spec) return;
  const pt = eventToImagePoint(ev);
  if (!pt) return;
  state.points[spec.key] = pt;
  renderMeasure();
}

function renderMeasure() {
  const placed = Object.keys(state.points).length;
  el.btnUndoPoint.disabled = placed === 0;
  el.btnClearPoints.disabled = placed === 0;

  const spec = nextPointSpec();
  el.measurePrompt.hidden = !state.frozen;
  if (state.frozen) {
    el.measurePrompt.innerHTML = spec
      ? `<b>${placed + 1}/${POINTS.length} · Marca: ${spec.label}</b><span>${spec.hint}</span>`
      : '<b>Listo: los cinco puntos están marcados</b><span>Revisa las cotas y guárdalas como ficha. Puedes deshacer el último punto si quedó torcido.</span>';
  }

  const m = computeMeasures(state.points, Number(el.crankLength.value || 172.5));
  state.measures = m;
  el.measureResults.hidden = !m;
  if (m) {
    // Cuánto vale en milímetros un píxel de pantalla. El escenario reduce la
    // imagen, así que la precisión del dedo es peor que la de la imagen.
    const box = el.overlay.getBoundingClientRect();
    const fit = Math.min(box.width / el.overlay.width, box.height / el.overlay.height) || 1;
    const mmPerScreenPx = m.scale / fit;
    el.measurePrecision.hidden = false;
    el.measurePrecision.innerHTML =
      `Escala <b>${m.scale.toFixed(2)} mm</b> por píxel de imagen. A este tamaño de pantalla,
       cada píxel que pinchas vale <b>${mmPerScreenPx.toFixed(1)} mm</b>: usa las flechas del
       teclado para afinar el último punto, o amplía la ventana antes de marcar.`;
    el.measureValues.innerHTML = m.values.map((v) => `
      <div class="metric ok" title="${v.hint}">
        <div class="m-label">${v.label}</div>
        <div class="m-value">${v.value.toFixed(v.unit === '°' ? 1 : 0)}${v.unit}</div>
        <div class="m-hint">${v.hint}</div>
      </div>`).join('');
    el.measureValues.querySelectorAll('.metric').forEach((n) =>
      n.addEventListener('click', () => n.classList.toggle('expanded')));
  }
  drawMeasureOverlay();
  // La comparación depende de la medición actual: sin esto la tabla se queda
  // con la que se generó al guardar la ficha, que da diferencia cero.
  renderDiff();
}

function drawMeasureOverlay() {
  const ctx = el.overlay.getContext('2d');
  const w = el.overlay.width, h = el.overlay.height;
  ctx.clearRect(0, 0, w, h);
  if (!state.frozen) return;

  const r = Math.max(5, w / 150);
  const font = Math.max(12, w / 70);
  ctx.font = `600 ${font}px ${getComputedStyle(document.body).fontFamily}`;
  ctx.textBaseline = 'middle';

  // Ejes desde el pedalier: dan contexto visual a las cotas.
  if (state.points.bb) {
    const { x, y } = state.points.bb;
    ctx.save();
    ctx.setLineDash([5, 6]);
    ctx.strokeStyle = 'rgba(74,168,255,.55)';
    ctx.lineWidth = Math.max(1, w / 900);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y);
    ctx.moveTo(x, 0); ctx.lineTo(x, h);
    ctx.stroke();
    ctx.restore();
  }

  // Plano de apoyo del sillín.
  if (state.points.nose && state.points.rear) {
    ctx.strokeStyle = '#35d07f';
    ctx.lineWidth = Math.max(2, w / 400);
    ctx.beginPath();
    ctx.moveTo(state.points.nose.x, state.points.nose.y);
    ctx.lineTo(state.points.rear.x, state.points.rear.y);
    ctx.stroke();
  }

  for (const spec of POINTS) {
    const p = state.points[spec.key];
    if (!p) continue;
    ctx.fillStyle = '#ff5a4e';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(1.5, w / 700);
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // Cruz interior para afinar la lectura del centro.
    ctx.beginPath();
    ctx.moveTo(p.x - r * 1.9, p.y); ctx.lineTo(p.x + r * 1.9, p.y);
    ctx.moveTo(p.x, p.y - r * 1.9); ctx.lineTo(p.x, p.y + r * 1.9);
    ctx.stroke();

    const text = spec.label;
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(5,10,16,.78)';
    ctx.fillRect(p.x + r * 2, p.y - font, tw + 8, font * 1.5);
    ctx.fillStyle = '#eaf4ff';
    ctx.fillText(text, p.x + r * 2 + 4, p.y - font * 0.25);
  }
}

function setFrozen(on) {
  state.frozen = on;
  el.stage.classList.toggle('measuring', on);
  el.btnFreeze.textContent = on ? 'Reanudar vídeo' : 'Congelar imagen';
  el.btnFreeze.classList.toggle('btn-primary', !on);
  if (on) {
    el.video.pause();
  } else {
    el.video.play().catch(() => {});
    el.measurePrompt.hidden = true;
  }
  renderMeasure();
}

/* --- Fichas: persistencia y comparación --- */

const FICHAS_KEY = 'bikefit.fichas.v1';

function loadFichas() {
  try {
    return JSON.parse(localStorage.getItem(FICHAS_KEY) ?? '[]');
  } catch {
    return [];   // modo privado o almacenamiento bloqueado
  }
}

function saveFichas(list) {
  try {
    localStorage.setItem(FICHAS_KEY, JSON.stringify(list.slice(-10)));
  } catch { /* sin persistencia: las fichas viven solo en esta sesión */ }
}

function renderFichas() {
  const list = state.fichas;
  el.fichasBox.hidden = list.length === 0;
  el.fichasList.innerHTML = list.map((f, i) => `
    <li>
      <label>
        <input type="radio" name="baseline" value="${i}" ${state.baseline === i ? 'checked' : ''} />
        <b>${f.name}</b>
        <span>${new Date(f.at).toLocaleString('es-ES')}</span>
      </label>
      <button class="btn btn-small" data-del="${i}">Borrar</button>
    </li>`).join('');

  el.fichasList.querySelectorAll('input[name=baseline]').forEach((r) =>
    r.addEventListener('change', () => { state.baseline = Number(r.value); renderDiff(); }));
  el.fichasList.querySelectorAll('button[data-del]').forEach((b) =>
    b.addEventListener('click', () => {
      const i = Number(b.dataset.del);
      state.fichas.splice(i, 1);
      if (state.baseline === i) state.baseline = null;
      else if (state.baseline > i) state.baseline--;
      saveFichas(state.fichas);
      renderFichas();
    }));
  renderDiff();
}

function renderDiff() {
  const base = state.fichas[state.baseline];
  if (!base || !state.measures) { el.fichaDiff.innerHTML = ''; return; }
  const rows = diffMeasures(base, state.measures);
  el.fichaDiff.innerHTML = `
    <h3>Cambio respecto a «${base.name}»</h3>
    <table class="diff">
      <tbody>${rows.map((d) => `
        <tr class="${d.significant ? 'sig' : ''}">
          <td>${d.label}</td>
          <td class="num">${d.before.toFixed(d.unit === '°' ? 1 : 0)}</td>
          <td class="arrow">→</td>
          <td class="num">${d.after.toFixed(d.unit === '°' ? 1 : 0)}</td>
          <td class="num delta">${d.delta >= 0 ? '+' : ''}${d.delta.toFixed(d.unit === '°' ? 1 : 0)}${d.unit}</td>
        </tr>`).join('')}</tbody>
    </table>
    <p class="vis-help">Resaltado lo que cambió más de 2 mm o medio grado; por debajo de eso
    es ruido de marcado, no un cambio real de posición.</p>`;
}

/* ============================== Modo demo ============================== */

// `?demo=1` monta un informe con datos de ejemplo. Sirve para revisar el
// formato de salida sin montar la bici en el rodillo.
function runDemo() {
  state.tracker.cycles = Array.from({ length: 14 }, (_, i) => ({
    durationMs: 682 + ((i % 3) - 1) * 12,
    kneeExtension: 134 + ((i % 4) - 1.5) * 1.4,
    kneeFlexion: 71 + ((i % 3) - 1),
    hipMin: 44, hipMax: 92,
    ankleAtBdc: 112, ankleAtTdc: 86, ankleRom: 22,
    torso: 47, elbow: 172, shoulder: 88, arm: 24,
    kopsPx: 18.7, femurPx: 266, crankTravelPx: 230,
    vis: { shoulder: 0.97, elbow: 0.91, wrist: 0.88, hip: 0.96, knee: 0.94, ankle: 0.93, foot: 0.82 },
  }));
  el.riderName.value = el.riderName.value || 'Ciclista de ejemplo';
  makeReport();
}

/** Avisa de los dos bloqueos que impiden la cámara antes incluso de pedirla. */
async function warnAboutBlockers() {
  if (!window.isSecureContext) {
    showStageError(
      'Contexto no seguro: la cámara no se puede abrir',
      'Los navegadores solo dan acceso a la cámara en <code>localhost</code> o <code>https</code>. Arranca el servidor con <code>node server.mjs</code> y entra por <code>http://localhost:5173</code>.',
      await collectDiagnostics(), null);
    return;
  }
  if (window.self !== window.top) {
    showStageError(
      'Página incrustada en un iframe',
      'Si el contenedor no concede permiso de cámara, <strong>Activar cámara</strong> fallará. Ábrela en una pestaña normal: <code>http://localhost:5173</code>. Puedes intentarlo igualmente.',
      await collectDiagnostics(), null);
  }
}

el.btnCamera.disabled = true;
el.modelQuality.value = defaultModelKey();
initEngine(el.modelQuality.value);
warnAboutBlockers();
state.fichas = loadFichas();
// Al volver tras cambiar una pieza, lo que quieres comparar es contra lo
// último que mediste: queda preseleccionado.
if (state.fichas.length) state.baseline = state.fichas.length - 1;
renderFichas();
if (new URLSearchParams(location.search).has('demo')) runDemo();
