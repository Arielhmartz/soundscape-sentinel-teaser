// Escena 3D (Three.js): nube de puntos, cámara orbital, etiquetas de especies con pulso y línea.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { clamp, easeInOut, cssVar, temaOscuro, hexToRgb01, reducedMotion, mulberry32, hashStr } from "./util.js";
import { posicionIlustrativa } from "../estratos.js";

export const VIDA_ETIQUETA = 3.0;   // s que dura una etiqueta desde que la especie canta

const RAMPA_OSCURO = ["#0c5a45", "#1fa774", "#6fe08a", "#d4f58a"];
const RAMPA_CLARO = ["#0a4a3a", "#0f7a55", "#3d9a45", "#8ab52e"];
function lutRampa(stops) {
  const rgb = stops.map(hexToRgb01), N = 64, out = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const t = (i / (N - 1)) * (rgb.length - 1), a = Math.min(rgb.length - 2, Math.floor(t)), f = t - a;
    for (let c = 0; c < 3; c++) out[3 * i + c] = rgb[a][c] + (rgb[a + 1][c] - rgb[a][c]) * f;
  }
  return out;
}

function texturaAnillo(suave) {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d"), grd = g.createRadialGradient(64, 64, 0, 64, 64, 62);
  if (suave) { grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(0.35, "rgba(255,255,255,.55)"); grd.addColorStop(1, "rgba(255,255,255,0)"); }
  else { grd.addColorStop(0, "rgba(255,255,255,0)"); grd.addColorStop(0.72, "rgba(255,255,255,0)"); grd.addColorStop(0.86, "rgba(255,255,255,1)"); grd.addColorStop(1, "rgba(255,255,255,0)"); }
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class SceneView {
  constructor(host) {
    this.host = host;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "p3d-canvas";
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", "Escena 3D de un bosque como nube de puntos, con etiquetas de las especies que cantan");
    host.prepend(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: "low-power" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.5, 800);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.autoRotateSpeed = 0.45; this.controls.maxPolarAngle = Math.PI * 0.53;
    this.rotar = !reducedMotion(); this.interactuando = false; this._rt = 0;
    this._onStart = () => { this.interactuando = true; clearTimeout(this._rt); this.tween = null; };
    this._onEnd = () => { clearTimeout(this._rt); this._rt = setTimeout(() => { this.interactuando = false; }, 5000); };
    this.controls.addEventListener("start", this._onStart); this.controls.addEventListener("end", this._onEnd);

    // capa de etiquetas (HTML) + líneas (SVG) por encima del canvas
    this.capa = document.createElement("div"); this.capa.className = "p3d-labels"; host.appendChild(this.capa);
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); this.svg.setAttribute("class", "p3d-lines"); this.svg.setAttribute("aria-hidden", "true"); this.capa.appendChild(this.svg);

    this.texAnillo = texturaAnillo(false); this.texPunto = texturaAnillo(true);
    this.etiquetas = new Map();       // sci → {el, linea, anillo, punto, anchor}
    this.puntos = null; this.datos = null; this.tween = null;
    this.w = 1; this.h = 1; this._v = new THREE.Vector3(); this._lutOsc = lutRampa(RAMPA_OSCURO); this._lutCla = lutRampa(RAMPA_CLARO);
    this.usarColorOriginal = false;

    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(host);
    this.resize();
  }

  resize() {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    if (w === this.w && h === this.h && this._ok) return;
    this.w = w; this.h = h; this._ok = true;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  }

  // ── nube ───────────────────────────────────────────────────────────────────
  setForest(datos) {
    this.quitarNube(); this.datos = datos;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(datos.pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(datos.count * 3), 3));
    this.mat = new THREE.PointsMaterial({ size: 0.16, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.92, depthWrite: false });
    this.puntos = new THREE.Points(geo, this.mat); this.puntos.frustumCulled = false;
    this.scene.add(this.puntos);
    this.camera.near = Math.max(0.05, datos.radio * 0.01); this.camera.far = datos.radio * 30; this.camera.updateProjectionMatrix();
    this.aplicarTema();
    this.reposicionarEtiquetas();
    this.vista("reset", true);
  }
  quitarNube() {
    if (!this.puntos) return;
    this.scene.remove(this.puntos); this.puntos.geometry.dispose(); this.mat.dispose(); this.puntos = null;
  }
  aplicarTema() {
    const oscuro = temaOscuro();
    if (this.puntos && this.datos) {
      const d = this.datos, col = this.puntos.geometry.attributes.color, lut = oscuro ? this._lutOsc : this._lutCla;
      const original = this.usarColorOriginal && d.colores;
      for (let i = 0; i < d.count; i++) {
        if (original) { col.array[3 * i] = d.colores[3 * i]; col.array[3 * i + 1] = d.colores[3 * i + 1]; col.array[3 * i + 2] = d.colores[3 * i + 2]; }
        else { const k = Math.min(63, Math.floor(d.h[i] * 63)) * 3; col.array[3 * i] = lut[k]; col.array[3 * i + 1] = lut[k + 1]; col.array[3 * i + 2] = lut[k + 2]; }
      }
      col.needsUpdate = true;
      this.mat.size = d.radio * (oscuro ? 0.0042 : 0.0048); this.mat.opacity = oscuro ? 0.92 : 0.88; this.mat.needsUpdate = true;
    }
    const amber = cssVar("--amber") || "#f5a524", accent = cssVar("--accent") || "#52d6c1";
    for (const e of this.etiquetas.values()) { e.anillo.material.color.set(amber); e.punto.material.color.set(accent); }
  }
  alternarColorOriginal() { this.usarColorOriginal = !this.usarColorOriginal; this.aplicarTema(); return this.usarColorOriginal; }

  // ── vistas de cámara ──────────────────────────────────────────────────────
  vista(nombre, inmediato = false) {
    const d = this.datos; if (!d) return;
    const R = d.radio, H = d.alto, b = d.base, V = THREE.Vector3;
    let pos, tgt;
    if (nombre === "superior") { pos = new V(0.01, b + R * 2.3, 0.01); tgt = new V(0, b, 0); }
    else if (nombre === "suelo") { pos = new V(R * 0.92, b + 1.7, R * 0.1); tgt = new V(0, b + 4.5, 0); }   // a 1,7 m del suelo, mirando hacia el interior
    else if (nombre === "completa") {
      const rb = Math.hypot(R, H * 0.6), dist = (rb / Math.sin((this.camera.fov * Math.PI) / 360)) * 0.78;
      pos = new V(0.7, 0.55, 0.7).normalize().multiplyScalar(dist).add(new V(0, b + H * 0.4, 0)); tgt = new V(0, b + H * 0.4, 0);
    } else { pos = new V(R * 1.3, b + H * 1.25, R * 1.3); tgt = new V(0, b + H * 0.35, 0); }
    if (inmediato) { this.camera.position.copy(pos); this.controls.target.copy(tgt); this.controls.update(); this.tween = null; return; }
    this.interactuando = false;
    this.tween = { t0: performance.now(), ms: 750, p0: this.camera.position.clone(), p1: pos, g0: this.controls.target.clone(), g1: tgt };
  }

  // ── etiquetas ─────────────────────────────────────────────────────────────
  // Una etiqueta por CADA llamada (evento). La especie fija el "barrio" (estrato + posición con semilla por especie);
  // cada llamada se desplaza unos metros dentro de él, también con semilla fija, para que varias a la vez no se tapen.
  registrarEspecies() {   // al cambiar de fuente: descarta las etiquetas anteriores
    for (const e of this.etiquetas.values()) this.quitarEtiqueta(e);
    this.etiquetas.clear();
  }
  crearEtiqueta(ev) {
    const el = document.createElement("div"); el.className = "p3d-tag"; el.style.opacity = "0";
    el.innerHTML = `<span class="p3d-tag-code"></span>`; el.firstChild.textContent = ev.code; el.title = `${ev.common} (${ev.sci})`;
    this.capa.appendChild(el);
    const linea = document.createElementNS("http://www.w3.org/2000/svg", "line"); linea.setAttribute("class", "p3d-line"); linea.style.opacity = "0"; this.svg.appendChild(linea);
    const mk = (tex, orden) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, opacity: 0 })); s.renderOrder = orden; s.visible = false; this.scene.add(s); return s; };
    const e = { key: ev.key, sci: ev.sci, el, linea, anillo: mk(this.texAnillo, 11), punto: mk(this.texPunto, 12), anchor: new THREE.Vector3(), _on: false };
    this.posicionar(e); this.etiquetas.set(ev.key, e);
    e.anillo.material.color.set(cssVar("--amber") || "#f5a524"); e.punto.material.color.set(cssVar("--accent") || "#52d6c1");
    return e;
  }
  posicionar(e) {
    const d = this.datos; if (!d) return;
    const p = posicionIlustrativa(e.sci, d.radio, d.base, d.alto), rng = mulberry32(hashStr(e.key)), ang = rng() * Math.PI * 2, rad = Math.sqrt(rng()) * d.radio * 0.07;
    e.anchor.set(p.x + Math.cos(ang) * rad, Math.max(d.base + 0.3, p.y + (rng() - 0.5) * d.alto * 0.06), p.z + Math.sin(ang) * rad);
    e.anillo.position.copy(e.anchor); e.punto.position.copy(e.anchor);
  }
  reposicionarEtiquetas() { for (const e of this.etiquetas.values()) this.posicionar(e); }   // al cambiar la nube
  quitarEtiqueta(e) {
    e.el.remove(); e.linea.remove();
    for (const s of [e.anillo, e.punto]) { this.scene.remove(s); s.material.dispose(); }
  }
  // `activos`: [{key, sci, code, common, conf, age}] (llamadas sonando ahora, age = s desde que empezó). Todo lo demás se oculta.
  actualizarEtiquetas(activos) {
    const d = this.datos, w = this.w, h = this.h, base = d ? d.radio * 0.032 : 1, MAX = 14;
    const lista = activos.length > MAX ? [...activos].sort((a, b) => a.age - b.age).slice(0, MAX) : activos, vivos = new Set();
    for (const a of lista) {
      if (!d) break;
      const e = this.etiquetas.get(a.key) || this.crearEtiqueta(a); vivos.add(e);
      const age = a.age, entra = clamp(age / 0.18, 0, 1), sale = age < 1.6 ? 1 : 1 - clamp((age - 1.6) / (VIDA_ETIQUETA - 1.6), 0, 1);
      const alfa = (0.3 + 0.7 * clamp(a.conf, 0, 1)) * entra * sale;     // la opacidad depende de la confianza
      const v = this._v.copy(e.anchor).project(this.camera);
      if (v.z > 1) { e.el.style.opacity = "0"; e.linea.style.opacity = "0"; e.anillo.visible = e.punto.visible = false; continue; }
      e._on = true;
      const sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * h;
      const lx = clamp(sx + 22, 4, w - 58), ly = clamp(sy - 40, 4, h - 28);
      e.el.style.transform = `translate(${lx.toFixed(1)}px,${ly.toFixed(1)}px)`; e.el.style.opacity = alfa.toFixed(3);
      e.linea.setAttribute("x1", sx.toFixed(1)); e.linea.setAttribute("y1", sy.toFixed(1));
      e.linea.setAttribute("x2", (lx + 8).toFixed(1)); e.linea.setAttribute("y2", (ly + 24).toFixed(1)); e.linea.style.opacity = (alfa * 0.9).toFixed(3);
      const p = clamp(age / 1.4, 0, 1);
      e.punto.visible = true; e.punto.scale.setScalar(base * 0.9); e.punto.material.opacity = alfa;
      e.anillo.visible = p < 1; e.anillo.scale.setScalar(base * (1 + 4.5 * p)); e.anillo.material.opacity = (1 - p) * clamp(a.conf + 0.3, 0, 1);
    }
    for (const e of this.etiquetas.values()) if (!vivos.has(e) && e._on) { e._on = false; e.el.style.opacity = "0"; e.linea.style.opacity = "0"; e.anillo.visible = e.punto.visible = false; }
    if (this.etiquetas.size > 48) {   // la piscina no crece sin límite: se descartan las inactivas más antiguas
      for (const [k, e] of this.etiquetas) { if (this.etiquetas.size <= 40) break; if (!vivos.has(e)) { this.quitarEtiqueta(e); this.etiquetas.delete(k); } }
    }
  }

  // ── bucle ─────────────────────────────────────────────────────────────────
  render() {
    if (this.tween) {
      const k = clamp((performance.now() - this.tween.t0) / this.tween.ms, 0, 1), e = easeInOut(k);
      this.camera.position.lerpVectors(this.tween.p0, this.tween.p1, e); this.controls.target.lerpVectors(this.tween.g0, this.tween.g1, e);
      if (k >= 1) this.tween = null;
    }
    this.controls.autoRotate = this.rotar && !this.interactuando && !this.tween;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    clearTimeout(this._rt);
    this.ro.disconnect();
    this.controls.removeEventListener("start", this._onStart); this.controls.removeEventListener("end", this._onEnd); this.controls.dispose();
    for (const e of this.etiquetas.values()) this.quitarEtiqueta(e);
    this.etiquetas.clear(); this.quitarNube();
    this.texAnillo.dispose(); this.texPunto.dispose();
    this.renderer.dispose(); this.renderer.forceContextLoss();
    this.canvas.remove(); this.capa.remove();
  }
}
