// Modo DEMO: audio sintético de 30 s (cantos estilizados de especies de Concepción) + detecciones conocidas.
// No es una grabación real: sirve para probar el visor sin depender del sensor.
import { mulberry32, clamp } from "./util.js";
import { codigo4, bandaDe } from "../estratos.js";

export const SR = 48000;
const DUR = 30;

// ── síntesis ─────────────────────────────────────────────────────────────────
function nota(out, t0, dur, f0, f1, amp = 1, h = [1, 0.3, 0.1], vib = 0) {
  const i0 = Math.floor(t0 * SR), n = Math.floor(dur * SR); let ph = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n, f = f0 + (f1 - f0) * u + (vib ? vib * Math.sin(2 * Math.PI * 30 * u * dur) : 0);
    ph += (2 * Math.PI * f) / SR;
    const env = Math.pow(Math.sin(Math.PI * Math.min(1, u)), 0.55); let s = 0;
    for (let k = 0; k < h.length; k++) if (f * (k + 1) < SR / 2 - 500) s += h[k] * Math.sin(ph * (k + 1));
    const idx = i0 + i; if (idx >= 0 && idx < out.length) out[idx] += amp * env * s;
  }
}
function clic(out, t0, amp, rng) {
  const i0 = Math.floor(t0 * SR), n = Math.floor(0.03 * SR);
  for (let i = 0; i < n; i++) { const idx = i0 + i; if (idx < out.length) out[idx] += amp * (rng() * 2 - 1) * Math.exp(-i / (SR * 0.004)) + amp * 0.5 * Math.sin((2 * Math.PI * 420 * i) / SR) * Math.exp(-i / (SR * 0.01)); }
}

// cada voz escribe en `out` desde t0 y devuelve su duración (s)
const VOCES = {
  "Turdus falcklandii": (o, t, g) => { [[0, 2400, 3000], [0.3, 3200, 2700], [0.62, 2600, 3400], [0.98, 3000, 2300]].forEach(([d, a, b]) => nota(o, t + d, 0.22, a, b, 0.55 * g, [1, 0.3])); return 1.25; },
  "Elaenia albiceps": (o, t, g) => { for (let k = 0; k < 3; k++) nota(o, t + k * 0.45, 0.32, 3300, 4700, 0.5 * g, [1, 0.15]); return 1.3; },
  "Zonotrichia capensis": (o, t, g) => { nota(o, t, 0.25, 3000, 3800, 0.45 * g, [1, 0.2]); for (let k = 0; k < 14; k++) nota(o, t + 0.32 + k * 0.05, 0.035, k % 2 ? 5200 : 4200, k % 2 ? 5200 : 4200, 0.4 * g, [1, 0.2]); return 1.05; },
  "Sephanoides sephaniodes": (o, t, g, r) => { for (let k = 0; k < 6; k++) nota(o, t + k * 0.1, 0.06, 6200 + r() * 600, 7400 + r() * 500, 0.3 * g, [1, 0.1]); return 0.7; },
  "Pteroptochos tarnii": (o, t, g) => { for (let k = 0; k < 3; k++) nota(o, t + k * 0.3, 0.13, 900, 1100, 0.6 * g, [1, 0.7, 0.45, 0.3]); return 0.9; },
  "Scelorchilus rubecula": (o, t, g) => { [0, 0.35, 0.62, 0.82, 0.98].forEach((d, k) => nota(o, t + d, 0.14, 1700 + k * 40, 1950, 0.55 * g, [1, 0.5, 0.25])); return 1.15; },
  "Aphrastura spinicauda": (o, t, g) => { for (let k = 0; k < 16; k++) nota(o, t + k * 0.06, 0.03, 6200 - k * 150, 6000 - k * 150, 0.35 * g, [1, 0.2]); return 1.0; },
  "Campephilus magellanicus": (o, t, g, r) => { for (let rep = 0; rep < 2; rep++) { clic(o, t + rep * 0.9, 0.8 * g, r); clic(o, t + rep * 0.9 + 0.14, 0.7 * g, r); } return 1.2; },
  "Enicognathus ferrugineus": (o, t, g) => { for (let k = 0; k < 3; k++) nota(o, t + k * 0.5, 0.4, 2400, 2100, 0.4 * g, [1, 0.8, 0.6, 0.5], 60); return 1.5; },
  "Tachycineta meyeni": (o, t, g, r) => { for (let k = 0; k < 8; k++) nota(o, t + k * 0.09, 0.07, k % 2 ? 5200 : 3200 + r() * 300, k % 2 ? 3300 : 5000, 0.35 * g, [1, 0.2]); return 0.8; },
  "Anairetes parulus": (o, t, g) => { nota(o, t, 0.25, 7200, 5600, 0.3 * g, [1, 0.1]); return 0.3; },
};
const COMUN = {
  "Turdus falcklandii": "Zorzal Patagón", "Elaenia albiceps": "Fiofío Crestiblanco", "Zonotrichia capensis": "Chincol",
  "Sephanoides sephaniodes": "Picaflor Chico", "Pteroptochos tarnii": "Hued-hued del Sur", "Scelorchilus rubecula": "Chucao",
  "Aphrastura spinicauda": "Rayadito", "Campephilus magellanicus": "Carpintero Negro", "Enicognathus ferrugineus": "Cachaña",
  "Tachycineta meyeni": "Golondrina Chilena", "Anairetes parulus": "Cachudito",
};

export const DEMOS = {
  amanecer: {
    titulo: "Bosque nativo · amanecer", bosque: "nativo", ruido: 0.012, viento: 0.012, semilla: 21,
    eventos: { "Turdus falcklandii": 3, "Elaenia albiceps": 4, "Zonotrichia capensis": 3, "Sephanoides sephaniodes": 3, "Pteroptochos tarnii": 2,
      "Scelorchilus rubecula": 3, "Aphrastura spinicauda": 3, "Campephilus magellanicus": 2, "Enicognathus ferrugineus": 2, "Tachycineta meyeni": 2, "Anairetes parulus": 3 },
  },
  mediodia: {
    titulo: "Plantación · mediodía", bosque: "plantacion", ruido: 0.02, viento: 0.05, semilla: 87,
    eventos: { "Turdus falcklandii": 1, "Elaenia albiceps": 2, "Zonotrichia capensis": 2, "Tachycineta meyeni": 2 },
  },
};

function aWav(f32) {
  const n = f32.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + 2 * i, clamp(f32[i], -1, 1) * 32767, true);
  return buf;
}

const memo = new Map();
// Devuelve {wav: ArrayBuffer, duracion, dets[], titulo, bosque}
export function generarDemo(variante) {
  if (memo.has(variante)) return memo.get(variante);
  const plan = DEMOS[variante], rng = mulberry32(plan.semilla), out = new Float32Array(DUR * SR), dets = [];
  // eventos: sin repetir la misma especie a menos de 4 s
  for (const [sci, n] of Object.entries(plan.eventos)) {
    const usados = [];
    for (let k = 0; k < n; k++) {
      let t0 = 0.6, ok = false;
      for (let intento = 0; intento < 40 && !ok; intento++) { t0 = 0.6 + rng() * (DUR - 3.2); ok = usados.every(u => Math.abs(u - t0) > 4); }
      usados.push(t0);
      const conf = +(0.55 + rng() * 0.43).toFixed(2), g = 0.55 + 0.45 * conf;
      const dur = VOCES[sci](out, t0, g, rng);
      dets.push({ sci, common: COMUN[sci], code: codigo4(sci), conf, t0, t1: t0 + dur + 0.15, banda: bandaDe(sci) });
    }
  }
  dets.sort((a, b) => a.t0 - b.t0);
  // fondo: siseo + viento (ruido pasa-bajos)
  let lp = 0;
  for (let i = 0; i < out.length; i++) {
    const wn = rng() * 2 - 1; lp += 0.03 * (wn - lp);
    out[i] += plan.ruido * 0.5 * wn + plan.viento * 9 * lp * (0.6 + 0.4 * Math.sin((2 * Math.PI * 0.13 * i) / SR));
  }
  let pico = 0; for (let i = 0; i < out.length; i++) pico = Math.max(pico, Math.abs(out[i]));
  const k = 0.85 / (pico || 1); for (let i = 0; i < out.length; i++) out[i] *= k;
  const res = { wav: aWav(out), duracion: DUR, dets, titulo: plan.titulo, bosque: plan.bosque };
  memo.set(variante, res); return res;
}
export const liberarDemos = () => memo.clear();
