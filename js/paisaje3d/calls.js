// Detección ORIENTATIVA de llamadas individuales dentro de cada detección.
// El sensor marca una ventana de 3 s por especie; dentro (y alrededor) esa especie suele cantar varias veces.
// Aquí se busca la cresta de frecuencia de la ventana y se marca cada pico de energía en esa misma banda.
// No es un identificador: solo reparte la etiqueta de la especie entre las veces que suena.
import { clamp } from "./util.js";
import { bandaDe } from "../estratos.js";

const MARGEN = 7.5;      // s a cada lado de la detección dentro del mismo clip
const SEPARACION = 0.35; // s mínimos entre dos llamadas de la misma especie
const ANCHO_BANDA = 250; // Hz a cada lado de la cresta (las llamadas son de banda estrecha)
const CONTRASTE_MIN = 20; // unidades (0–255, ≈ 5,7 dB) que debe sobresalir la llamada del fondo; si no, no se separa en llamadas

const mediana = a => { const b = Float32Array.from(a).sort(); return b.length ? b[b.length >> 1] : 0; };

// spec: {frames, bins, data(Uint8 frames×bins), fmax, dur}; dets: [{sci,common,code,conf,t0,t1,banda?}]
// segmentos: [{t0,t1}] tramos continuos de audio (los clips unidos del resumen). Devuelve eventos ordenados.
// Notas cortas dentro de un tramo continuo: columnas donde algunos bins (≈ 280 Hz) de 1,5–8 kHz sobresalen mucho de su fondo
// y la energía grave (0,2–1 kHz) no acompaña (lo que descarta golpes y ruidos de escritorio, que son de banda ancha).
function onsetsDeTramo(spec, seg) {
  const { frames, bins, data, fmax, dur } = spec, dt = dur / frames, df = fmax / bins;
  const c0 = Math.max(0, Math.floor(seg.t0 / dt)), c1 = Math.min(frames, Math.ceil(seg.t1 / dt)), n = c1 - c0;
  if (n < 10) return [];
  const bh0 = Math.floor(1500 / df), bh1 = Math.min(bins, Math.ceil(8000 / df)), bl0 = Math.floor(200 / df), bl1 = Math.ceil(1000 / df), K = Math.max(4, Math.round(280 / df));
  const fondo = new Float32Array(bins);
  for (let b = bl0; b < bh1; b++) { const col = new Float32Array(n); for (let i = 0; i < n; i++) col[i] = data[(c0 + i) * bins + b]; fondo[b] = mediana(col); }
  const score = new Float32Array(n), grave = new Float32Array(n), cima = new Float32Array(n);
  const ex = new Float32Array(bh1 - bh0);
  for (let i = 0; i < n; i++) {
    let best = 0, bi = 0;
    for (let b = bh0; b < bh1; b++) { const v = Math.max(0, data[(c0 + i) * bins + b] - fondo[b]); ex[b - bh0] = v; if (v > best) { best = v; bi = b; } }
    const orden = Float32Array.from(ex).sort(), top = orden.slice(orden.length - K);
    score[i] = media(top); cima[i] = bi;
    let g = 0; for (let b = bl0; b < bl1; b++) g += Math.max(0, data[(c0 + i) * bins + b] - fondo[b]); grave[i] = g / (bl1 - bl0);
  }
  const lis = score.map((v, i) => (score[Math.max(0, i - 1)] + v + score[Math.min(n - 1, i + 1)]) / 3), med = mediana(lis);
  const mad = mediana(lis.map(v => Math.abs(v - med))) * 1.4826, umbral = Math.max(med + 4 * mad, med + 14);
  const cand = [];
  for (let i = 2; i < n - 2; i++) {
    const v = lis[i]; if (v < umbral) continue;
    if (v >= lis[i - 1] && v >= lis[i + 1] && v >= lis[i - 2] && v >= lis[i + 2] && v > 2 * grave[i]) cand.push({ i, v });
  }
  cand.sort((a, b) => b.v - a.v);
  const sep = Math.max(1, Math.ceil(0.25 / dt)), out = [];
  for (const c of cand) if (out.length < 14 && out.every(o => Math.abs(o.i - c.i) >= sep)) out.push(c);
  return out.map(c => {
    let j = c.i; while (j > 0 && lis[j - 1] > med + 0.5 * (c.v - med) && c.i - j < 6) j--;
    const f = (cima[c.i] + 0.5) * df; return { tp: (c0 + c.i) * dt, t0: (c0 + j) * dt - 0.05, f0: Math.max(0, f - 500), f1: f + 500 };
  });
}
const media = a => { let s = 0; for (const v of a) s += v; return s / (a.length || 1); };

export function detectarLlamadas(spec, dets, segmentos, opciones = {}) {
  const { frames, bins, data, fmax, dur } = spec, dt = dur / frames, df = fmax / bins;
  const col = t => clamp(Math.round(t / dt), 0, frames - 1);
  const segs = segmentos?.length ? segmentos : [{ t0: 0, t1: dur }];
  const eventos = [];
  for (const d of dets) {
    const seg = segs.find(s => d.t0 >= s.t0 - 0.01 && d.t0 < s.t1 + 0.01) || { t0: 0, t1: dur };
    // si en el mismo tramo hay otras especies, solo se mira el entorno inmediato de la detección (si no, se confundirían sus sonidos)
    const sola = !dets.some(o => o.sci !== d.sci && o.t1 > d.t0 - MARGEN && o.t0 < d.t1 + MARGEN && o.t0 < seg.t1 && o.t1 > seg.t0), margen = sola ? MARGEN : 1.0;
    const w0 = col(Math.max(seg.t0, d.t0 - margen)), w1 = Math.max(w0 + 2, col(Math.min(seg.t1, d.t1 + margen)));
    const c0 = clamp(col(d.t0), w0, w1 - 1), c1 = clamp(Math.max(c0 + 1, col(d.t1)), c0 + 1, w1);
    const [fa, fb] = d.banda || bandaDe(d.sci);
    // la cresta se busca en un rango más ancho que la banda típica de la tabla (la especie puede cantar por debajo o encima)
    const b0 = clamp(Math.floor(Math.max(800, fa - 1500) / df), 0, bins - 2), b1 = clamp(Math.ceil(Math.min(fmax - 200, fb + 1500) / df), b0 + 2, bins);

    // 1) cresta: bin con más energía sobre su propio fondo dentro de la ventana del acierto
    const prom = new Float32Array(bins), fondo = new Float32Array(bins);
    for (let b = b0; b < b1; b++) {
      let suma = 0; for (let c = c0; c < c1; c++) suma += data[c * bins + b];
      const base = mediana(Array.from({ length: w1 - w0 }, (_, i) => data[(w0 + i) * bins + b]));
      fondo[b] = base; prom[b] = suma / (c1 - c0) - base;
    }
    let mejor = b0, vmax = -1e9;
    for (let b = b0 + 1; b < b1 - 1; b++) { const v = (prom[b - 1] + prom[b] + prom[b + 1]) / 3; if (v > vmax) { vmax = v; mejor = b; } }
    const centro = (mejor + 0.5) * df;
    // Sin llamadas separables: un solo evento, pero colocado donde REALMENTE suena (máximo de energía sobre el fondo dentro de la ventana de 3 s),
    // no al inicio de la ventana: así la etiqueta 3D aparece cuando se ve la llamada en el espectrograma.
    const retornoUnico = () => {
      const n = c1 - c0, ser = new Float32Array(n);
      for (let i = 0; i < n; i++) { let s = 0; for (let b = b0; b < b1; b++) s += Math.max(0, data[(c0 + i) * bins + b] - fondo[b]); ser[i] = s; }
      const lis2 = ser.map((v, i) => (ser[Math.max(0, i - 1)] + v + ser[Math.min(n - 1, i + 1)]) / 3);
      let ip = 0; for (let i = 1; i < n; i++) if (lis2[i] > lis2[ip]) ip = i;
      let tp = (d.t0 + d.t1) / 2, ini = tp - 0.25;
      if (lis2[ip] > 0) { let j = ip; while (j > 0 && lis2[j - 1] > lis2[ip] * 0.5 && ip - j < 8) j--; tp = (c0 + ip) * dt; ini = (c0 + j) * dt - 0.05; }
      eventos.push({ sci: d.sci, common: d.common, code: d.code, conf: d.conf, t0: Math.max(seg.t0, ini), t1: tp + 0.45, tp, banda: [fa, fb], deteccion: d.id ?? null });
    };
    if (vmax < 4) { retornoUnico(); continue; }          // sin una cresta clara: queda la detección como un solo evento

    // 2) envolvente de energía en esa banda a lo largo del tramo
    const k = Math.max(1, Math.round(ANCHO_BANDA / df)), bi = clamp(mejor - k, 0, bins - 1), bs = clamp(mejor + k + 1, bi + 1, bins);
    const e = new Float32Array(w1 - w0);
    for (let c = w0; c < w1; c++) { let s = 0; for (let b = bi; b < bs; b++) s += data[c * bins + b]; e[c - w0] = s / (bs - bi); }
    const lis = e.map((v, i) => (e[Math.max(0, i - 1)] + v + e[Math.min(e.length - 1, i + 1)]) / 3);
    const base = mediana(lis);
    let picoCaja = 0; for (let c = c0; c < c1; c++) picoCaja = Math.max(picoCaja, lis[c - w0]);
    if (picoCaja - base < CONTRASTE_MIN) { retornoUnico(); continue; }   // clip ruidoso: no se separan llamadas
    const umbral = base + 0.45 * (picoCaja - base);

    // 3) picos locales por encima del umbral, separados al menos SEPARACION
    const cand = [];
    for (let i = 2; i < lis.length - 2; i++) {
      const v = lis[i]; if (v < umbral) continue;
      if (v >= lis[i - 1] && v >= lis[i + 1] && v >= lis[i - 2] && v >= lis[i + 2]) cand.push({ i, v });
    }
    cand.sort((a, b) => b.v - a.v);
    const sep = Math.max(1, Math.ceil(SEPARACION / dt)), elegidos = [];
    for (const c of cand) if (elegidos.every(o => Math.abs(o.i - c.i) >= sep)) elegidos.push(c);
    if (!elegidos.length) { retornoUnico(); continue; }
    for (const c of elegidos) {
      const tp = (w0 + c.i) * dt, dentro = tp >= d.t0 - 0.5 && tp <= d.t1 + 0.5;
      let j = c.i; while (j > 0 && lis[j - 1] > base + 0.5 * (c.v - base) && c.i - j < 8) j--;   // el inicio de la llamada: donde la energía supera la mitad del pico
      eventos.push({ sci: d.sci, common: d.common, code: d.code, conf: dentro ? d.conf : +(d.conf * 0.85).toFixed(3), t0: Math.max(seg.t0, (w0 + j) * dt - 0.05), t1: tp + 0.45, tp,
        banda: [Math.max(0, centro - 2 * ANCHO_BANDA), centro + 2 * ANCHO_BANDA], deteccion: d.id ?? null, inferida: !dentro });
    }
  }
  // 3b) notas cortas que se ven en el espectrograma pero quedan fuera de la banda de la especie o de la ventana de 3 s del sensor
  //     (p. ej. series de notas breves): se marcan como llamadas "inferidas" y se les asigna la especie detectada más cercana en el tramo.
  if (opciones.onsets !== false) {
    for (const seg of segs) {
      const dsSeg = dets.filter(o => o.t0 < seg.t1 && o.t1 > seg.t0); if (!dsSeg.length) continue;
      for (const o of onsetsDeTramo(spec, seg)) {
        if (eventos.some(e => Math.abs(e.tp - o.tp) < 0.35)) continue;
        const cerca = dsSeg.reduce((m, x) => { const dist = o.tp < x.t0 ? x.t0 - o.tp : o.tp > x.t1 ? o.tp - x.t1 : 0; return dist < m.dist ? { d: x, dist } : m; }, { d: null, dist: 1e9 }).d;
        eventos.push({ sci: cerca.sci, common: cerca.common, code: cerca.code, conf: +(cerca.conf * 0.6).toFixed(3), t0: Math.max(seg.t0, o.t0), t1: o.tp + 0.45, tp: o.tp,
          banda: [o.f0, o.f1], deteccion: cerca.id ?? null, inferida: true, onset: true });
      }
    }
  }
  // 4) una misma llamada puede salir de dos detecciones vecinas: se funde si es de la misma especie y está a < 0,3 s
  eventos.sort((a, b) => a.tp - b.tp);
  const unicos = [];
  for (const ev of eventos) {
    const prev = unicos.findLast?.(o => o.sci === ev.sci) ?? [...unicos].reverse().find(o => o.sci === ev.sci);
    if (prev && Math.abs(prev.tp - ev.tp) < 0.3) { if (ev.conf > prev.conf) Object.assign(prev, ev); continue; }
    unicos.push(ev);
  }
  unicos.forEach((ev, i) => { ev.key = `${ev.sci}#${i}`; });
  return unicos;
}
