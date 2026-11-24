// Espectrograma calculado en el navegador: audio decodificado con Web Audio API + FFT propia, colormap magma.
import { clamp, cssVar } from "./util.js";
import { bandaDe } from "../estratos.js";

// Colormap magma (puntos de control de matplotlib) → LUT de 256 colores
const MAGMA = [[0, 0, 4], [28, 16, 68], [79, 18, 123], [129, 37, 129], [181, 54, 122], [229, 80, 100], [251, 135, 97], [254, 194, 135], [252, 253, 191]];
const LUT = (() => {
  const out = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * (MAGMA.length - 1), a = Math.min(MAGMA.length - 2, Math.floor(t)), f = t - a;
    for (let c = 0; c < 3; c++) out[3 * i + c] = MAGMA[a][c] + (MAGMA[a + 1][c] - MAGMA[a][c]) * f;
  }
  return out;
})();

// FFT radix-2 iterativa (in place)
function crearFFT(n) {
  const rev = new Uint32Array(n), cos = new Float32Array(n / 2), sin = new Float32Array(n / 2), bits = Math.log2(n);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = -Math.sin((2 * Math.PI * i) / n); }
  return function fft(re, im) {
    for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) for (let j = 0, k = 0; j < half; j++, k += step) {
        const a = i + j, b = a + half, tr = re[b] * cos[k] - im[b] * sin[k], ti = re[b] * sin[k] + im[b] * cos[k];
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  };
}

// Cede el hilo principal sin la espera mínima de setTimeout (que se alarga a 1 s en pestañas en segundo plano)
const cederTurno = () => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => { c.port1.close(); r(); }; c.port2.postMessage(0); });

// samples: Float32Array mono. Devuelve {frames, bins, data(Uint8 0..255), fmax, dur}
export async function calcularEspectrograma(samples, sr, { fmax = 12000, binHz = 23.4, rango = 72, maxCols = 3200 } = {}) {
  const nfft = 2 ** Math.round(Math.log2(sr / binHz)), hop = samples.length / sr > 60 ? nfft / 2 : nfft / 4, df = sr / nfft;
  const bins = Math.min(nfft / 2, Math.floor(fmax / df)), frames = Math.max(1, Math.floor((samples.length - nfft) / hop) + 1);
  const fft = crearFFT(nfft), win = new Float32Array(nfft), re = new Float32Array(nfft), im = new Float32Array(nfft);
  for (let i = 0; i < nfft; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (nfft - 1));
  // audios largos (p. ej. 5 min): se agrupan fotogramas en columnas (máximo de cada grupo) para limitar memoria
  const grp = Math.max(1, Math.ceil(frames / maxCols)), cols = Math.ceil(frames / grp);
  const db = new Float32Array(cols * bins).fill(-1e9);
  let t0 = performance.now();
  for (let f = 0; f < frames; f++) {
    const o = f * hop, base = Math.floor(f / grp) * bins;
    for (let i = 0; i < nfft; i++) { re[i] = (samples[o + i] || 0) * win[i]; im[i] = 0; }
    fft(re, im);
    for (let b = 0; b < bins; b++) { const v = 10 * Math.log10(re[b] * re[b] + im[b] * im[b] + 1e-12); if (v > db[base + b]) db[base + b] = v; }
    if (performance.now() - t0 > 12) { await cederTurno(); t0 = performance.now(); }   // no congelar la página (cada ~12 ms)
  }
  const muestra = []; const salto = Math.max(1, Math.floor(db.length / 20000));
  for (let i = 0; i < db.length; i += salto) muestra.push(db[i]);
  muestra.sort((a, b) => a - b);
  const vmax = muestra[Math.floor(muestra.length * 0.997)] ?? 0, vmin = vmax - rango, data = new Uint8Array(db.length);
  for (let i = 0; i < db.length; i++) data[i] = clamp(((db[i] - vmin) / (vmax - vmin)) * 255, 0, 255);
  return { frames: cols, bins, data, fmax: bins * df, dur: samples.length / sr };
}

export class SpecView {
  constructor(host, { onSeek }) {
    this.host = host; this.onSeek = onSeek; this.spec = null; this.dets = []; this.evs = []; this.dur = 0; this.t = 0; this.act = new Set();
    this.base = document.createElement("canvas"); this.base.className = "p3d-spec-base";
    this.over = document.createElement("canvas"); this.over.className = "p3d-spec-over";
    this.over.tabIndex = 0; this.over.setAttribute("role", "slider"); this.over.setAttribute("aria-label", "Espectrograma: haz clic para saltar a ese momento. Flechas: ±1 s");
    this.over.setAttribute("aria-valuemin", "0");
    host.append(this.base, this.over);
    this.off = document.createElement("canvas");
    this._pd = e => { this.arrastrando = true; this.over.setPointerCapture?.(e.pointerId); this.saltar(e); };
    this._pm = e => { if (this.arrastrando) this.saltar(e); };
    this._pu = () => { this.arrastrando = false; };
    this._kd = e => {
      const paso = e.shiftKey ? 5 : 1;
      if (e.key === "ArrowRight") { e.preventDefault(); this.onSeek(clamp(this.t + paso, 0, this.dur) / (this.dur || 1)); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); this.onSeek(clamp(this.t - paso, 0, this.dur) / (this.dur || 1)); }
    };
    this.over.addEventListener("pointerdown", this._pd); this.over.addEventListener("pointermove", this._pm);
    this.over.addEventListener("pointerup", this._pu); this.over.addEventListener("pointercancel", this._pu); this.over.addEventListener("keydown", this._kd);
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(host);
    this.resize();
  }
  saltar(e) { const r = this.over.getBoundingClientRect(), x0 = this.margenIzq, f = clamp((e.clientX - r.left - x0) / Math.max(1, r.width - x0), 0, 1); this.onSeek(f); }

  setData(spec, dets, dur, evs = []) {
    this.spec = spec; this.dets = dets; this.dur = dur; this.evs = evs;
    this.over.setAttribute("aria-valuemax", String(Math.round(dur)));
    const o = this.off; o.width = spec.frames; o.height = spec.bins;
    const g = o.getContext("2d"), img = g.createImageData(spec.frames, spec.bins), px = img.data;
    for (let f = 0; f < spec.frames; f++) for (let b = 0; b < spec.bins; b++) {
      const v = spec.data[f * spec.bins + b] * 3, p = 4 * ((spec.bins - 1 - b) * spec.frames + f);
      px[p] = LUT[v]; px[p + 1] = LUT[v + 1]; px[p + 2] = LUT[v + 2]; px[p + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.resize(true);
  }

  resize(force) {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight), dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!force && w === this.w && h === this.h) return;
    this.w = w; this.h = h; this.margenIzq = 44;
    for (const c of [this.base, this.over]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    this.dpr = dpr; this.dibujarBase(); this.draw(this.t, this.act, true);
  }
  dibujarBase() {
    const c = this.base, g = c.getContext("2d"); g.clearRect(0, 0, c.width, c.height);
    if (!this.spec) return;
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    const x0 = Math.round(this.margenIzq * this.dpr), alto = c.height - Math.round(18 * this.dpr);
    g.drawImage(this.off, x0, 0, c.width - x0, alto);
  }

  // t: segundos de reproducción. act: Set de sci activas.
  draw(t, act, forzar) {
    this.t = t; this.act = act || new Set();
    const c = this.over, g = c.getContext("2d"), d = this.dpr || 1;
    g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, this.w, this.h);
    if (!this.spec || !this.dur) return;
    const x0 = this.margenIzq, W = this.w - x0, Hs = this.h - 18, fmax = this.spec.fmax;
    const accent = cssVar("--accent") || "#52d6c1", amber = cssVar("--amber") || "#f5a524", mute = cssVar("--text-3") || "#82a0ac";
    // zona ya reproducida, ligeramente atenuada
    g.fillStyle = "rgba(0,0,0,.18)"; g.fillRect(x0, 0, W * clamp(t / this.dur, 0, 1), Hs);
    // detecciones como cajas (tiempo × banda de frecuencia típica)
    g.font = "600 10px 'Roboto Mono', monospace"; g.textBaseline = "top";
    for (const d2 of this.dets) {
      const [f0, f1] = d2.banda || bandaDe(d2.sci), xa = x0 + (d2.t0 / this.dur) * W, xb = x0 + (Math.min(d2.t1, this.dur) / this.dur) * W;
      // la caja se ilumina cuando suena una de SUS llamadas (misma regla que las etiquetas 3D), no al inicio de la ventana de 3 s
      const ya = Hs * (1 - Math.min(f1, fmax) / fmax), yb = Hs * (1 - f0 / fmax),
        on = this.evs.length ? this.evs.some(e => e.sci === d2.sci && e.tp >= d2.t0 - 0.5 && e.tp <= d2.t1 + 0.5 && t >= e.t0 && t <= e.t0 + 3) : this.act.has(d2.sci) && t >= d2.t0 && t <= d2.t0 + 3;
      g.lineWidth = on ? 2 : 1; g.strokeStyle = on ? amber : accent; g.globalAlpha = on ? 1 : 0.7;
      g.fillStyle = on ? "rgba(245,165,36,.18)" : "rgba(82,214,193,.07)"; g.fillRect(xa, ya, xb - xa, yb - ya);
      g.strokeRect(xa + 0.5, ya + 0.5, Math.max(2, xb - xa), yb - ya);
      g.globalAlpha = 1; g.fillStyle = on ? amber : accent;
      const tw = g.measureText(d2.code).width + 6, tx = clamp(xa, x0, this.w - tw), ty = Math.max(0, ya - 13);
      g.fillStyle = "rgba(6,18,26,.78)"; g.fillRect(tx, ty, tw, 12); g.fillStyle = on ? amber : accent; g.fillText(d2.code, tx + 3, ty + 1);
    }
    // llamadas individuales: una marca por cada vez que canta (la etiqueta 3D sale de cada una)
    for (const ev of this.evs) {
      const [f0, f1] = ev.banda, x = x0 + (ev.tp / this.dur) * W, ya = Hs * (1 - Math.min(f1, fmax) / fmax), yb = Hs * (1 - Math.max(0, f0) / fmax);
      const on = t >= ev.t0 && t <= ev.t0 + 3;
      g.strokeStyle = on ? amber : accent; g.lineWidth = on ? 2.5 : 1.5; g.globalAlpha = on ? 1 : 0.85;
      g.beginPath(); g.moveTo(x, ya); g.lineTo(x, yb); g.stroke();
    }
    g.globalAlpha = 1;
    // ejes: kHz a la izquierda, segundos abajo
    g.fillStyle = mute; g.font = "500 10px 'Roboto Mono', monospace"; g.textBaseline = "middle"; g.textAlign = "right";
    for (let k = 0; k <= fmax; k += 4000) { const y = Hs * (1 - k / fmax); g.fillText(k ? `${k / 1000} kHz` : "0", x0 - 6, clamp(y, 6, Hs - 6)); }
    g.textAlign = "center"; g.textBaseline = "top";
    const paso = this.dur > 200 ? 30 : this.dur > 90 ? 15 : this.dur > 40 ? 10 : this.dur > 16 ? 5 : 2;
    for (let s = 0; s <= this.dur + 0.01; s += paso) g.fillText(s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s}s`, clamp(x0 + (s / this.dur) * W, x0 + 12, this.w - 14), Hs + 4);
    // cursor
    const xc = x0 + clamp(t / this.dur, 0, 1) * W;
    g.strokeStyle = amber; g.lineWidth = 2; g.beginPath(); g.moveTo(xc, 0); g.lineTo(xc, Hs); g.stroke();
    g.fillStyle = amber; g.beginPath(); g.moveTo(xc - 5, 0); g.lineTo(xc + 5, 0); g.lineTo(xc, 7); g.closePath(); g.fill();
    this.over.setAttribute("aria-valuenow", String(Math.round(t)));
  }

  dispose() {
    this.ro.disconnect();
    for (const [ev, fn] of [["pointerdown", this._pd], ["pointermove", this._pm], ["pointerup", this._pu], ["pointercancel", this._pu], ["keydown", this._kd]]) this.over.removeEventListener(ev, fn);
    this.base.width = this.base.height = this.over.width = this.over.height = 0; this.off.width = this.off.height = 0;
    this.base.remove(); this.over.remove(); this.spec = null;
  }
}
