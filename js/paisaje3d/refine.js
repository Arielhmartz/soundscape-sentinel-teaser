// Cantos del teaser: mismos criterios para el monitor en vivo y para el visor 3D.
// 1) detectarLlamadas: cantos dentro de la ventana del sensor + notas sueltas (onsets) asignadas a la especie más cercana del clip.
// 2) notasFuertes: notas tonales claras de 1,5–5 kHz que el paso anterior no marcó (p. ej. un trino corto entre dos cantos).
// 3) refinar: descarta ruido bajo 1,5 kHz y cantos poco fiables, y une los de la misma especie que se solapan.
import { detectarLlamadas } from "./calls.js";

const mediana = a => { const b = Float32Array.from(a).sort(); return b.length ? b[b.length >> 1] : 0; };

function notasFuertes(esp, dets, segmentos, existentes) {
  const { frames, bins, data, fmax, dur } = esp, dt = dur / frames, df = fmax / bins, B = f => Math.round(f / df);
  const a0 = B(1500), a1 = B(5000), g0 = B(200), g1 = B(1000), h0 = B(8000), h1 = Math.min(bins, B(12000));
  const out = [];
  for (const s of (segmentos?.length ? segmentos : [{ t0: 0, t1: dur }])) {
    const dsS = dets.filter(d => d.t0 < s.t1 && d.t1 > s.t0); if (!dsS.length) continue;
    const c0 = Math.floor(s.t0 / dt), c1 = Math.min(frames, Math.ceil(s.t1 / dt)), n = c1 - c0; if (n < 10) continue;
    const fondo = new Float32Array(bins);
    for (let b = g0; b < h1; b++) { const col = new Float32Array(n); for (let i = 0; i < n; i++) col[i] = data[(c0 + i) * bins + b]; fondo[b] = mediana(col); }
    const sc = new Float32Array(n), fb = new Float32Array(n), gr = new Float32Array(n), hi = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let best = 0, bb = a0; for (let b = a0; b < a1; b++) { const v = data[(c0 + i) * bins + b] - fondo[b]; if (v > best) { best = v; bb = b; } }
      sc[i] = best; fb[i] = (bb + 0.5) * df;
      let g = 0; for (let b = g0; b < g1; b++) g += Math.max(0, data[(c0 + i) * bins + b] - fondo[b]); gr[i] = g / (g1 - g0);
      let h = 0; for (let b = h0; b < h1; b++) h += Math.max(0, data[(c0 + i) * bins + b] - fondo[b]); hi[i] = h / (h1 - h0);
    }
    const lis = sc.map((v, i) => (sc[Math.max(0, i - 1)] + v + sc[Math.min(n - 1, i + 1)]) / 3);
    for (let i = 3; i < n - 3; i++) {
      const v = lis[i]; if (v < 55) continue;
      let max = true; for (let j = -3; j <= 3; j++) if (lis[i + j] > v) max = false; if (!max) continue;
      if (gr[i] > 0.5 * v || hi[i] > 0.5 * v) continue;   // golpes y ruidos de banda ancha no son notas tonales
      const tp = (c0 + i) * dt;
      if (existentes.some(e => Math.abs(e.tp - tp) < 0.5 || (tp >= e.t0 - 0.1 && tp <= e.t1 + 0.1))) continue;
      if (out.some(o => Math.abs(o.tp - tp) < 0.5)) continue;
      const cerca = dsS.reduce((m, x) => { const d = tp < x.t0 ? x.t0 - tp : tp > x.t1 ? tp - x.t1 : 0; return d < m.d ? { x, d } : m; }, { x: null, d: 1e9 }).x;
      const f = fb[i];
      out.push({ sci: cerca.sci, common: cerca.common, code: cerca.code, conf: +(cerca.conf * 0.6).toFixed(3), t0: Math.max(s.t0, tp - 0.25), t1: tp + 0.55, tp,
        banda: [Math.max(0, f - 500), f + 500], deteccion: cerca.id ?? null, inferida: true, onset: true });
    }
  }
  return out;
}

export function refinar(eventos) {
  const ok = eventos.filter(e => {
    const centro = (e.banda[0] + e.banda[1]) / 2;
    return centro >= 1500 && !(e.inferida && e.conf < 0.55);
  }).sort((a, b) => a.t0 - b.t0);
  const out = [];
  for (const e of ok) {
    const p = [...out].reverse().find(o => o.sci === e.sci);
    if (p && e.t0 < p.t1 + 0.25) {
      p.t1 = Math.max(p.t1, e.t1);
      p.banda = [Math.min(p.banda[0], e.banda[0]), Math.max(p.banda[1], e.banda[1])];
      p.conf = Math.max(p.conf, e.conf);
      p.onset = p.onset && e.onset; p.inferida = p.inferida && e.inferida;
      continue;
    }
    out.push({ ...e });
  }
  out.forEach((e, i) => { e.key = `${e.sci}#${i}`; });
  return out;
}

export function detectarTodo(esp, dets, segmentos) {
  const base = detectarLlamadas(esp, dets, segmentos, { onsets: true });
  return refinar([...base, ...notasFuertes(esp, dets, segmentos, base)]);
}
