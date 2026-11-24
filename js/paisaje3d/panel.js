// Un panel = escena 3D + espectrograma + reproductor + lista de especies activas, ligados al mismo reloj (audio.currentTime).
import { SceneView, VIDA_ETIQUETA } from "./scene.js";
import { SpecView, calcularEspectrograma } from "./spectrogram.js";
import { cargarFuente } from "./sources.js";
import { detectarLlamadas } from "./calls.js";
import { detectarTodo } from "./refine.js";
import { getForest } from "./forest.js";
import { esc, fmtTime, clamp } from "./util.js";

const ICON_PLAY = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>`;
const ICON_PAUSE = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="4.5" height="16" rx="1.2"/><rect x="13.5" y="4" width="4.5" height="16" rx="1.2"/></svg>`;

export class Panel {
  constructor(parent, { etiqueta, fuentes, fuenteInicial, liveBase, D, presupuesto, compacto, callbacks }) {
    this.cb = callbacks; this.liveBase = liveBase; this.D = D; this.fuentes = fuentes; this.presupuesto = presupuesto;
    this.vol = 1; this.rate = 1; this.tok = 0; this.dataset = null; this.url = null; this._clave = ""; this._tt = "";
    const el = this.el = document.createElement("article");
    el.className = "p3d-panel" + (compacto ? " compacto" : ""); el.setAttribute("aria-label", "Panel " + etiqueta);
    el.innerHTML = `
      <header class="p3d-head">
        <span class="p3d-tagpanel">${esc(etiqueta)}</span>
        <label class="p3d-src-wrap"><span class="sr-only">Fuente de datos del panel ${esc(etiqueta)}</span><select class="p3d-src"></select></label>
        <span class="chip p3d-badge">…</span>
      </header>
      <div class="p3d-main">
        <div class="p3d-stage">
          <div class="p3d-views" role="group" aria-label="Vistas de cámara">
            <button class="btn sm" data-v="reset" type="button">Reset</button>
            <button class="btn sm" data-v="superior" type="button">Vista superior</button>
            <button class="btn sm" data-v="suelo" type="button">Vista de suelo</button>
            <button class="btn sm" data-v="completa" type="button">Nube completa</button>
            <button class="btn sm p3d-colorbtn" type="button" hidden>Color original</button>
          </div>
          <div class="p3d-state" role="status" aria-live="polite"></div>
          <p class="p3d-note">Posición ilustrativa por estrato, no localización acústica</p>
        </div>
        <aside class="p3d-side" aria-label="Especies activas">
          <h4>Activas ahora</h4>
          <ul class="p3d-active"></ul>
          <div class="p3d-rich" title="Especies distintas detectadas hasta el cursor"><span>Riqueza acumulada</span><b>0</b><span class="of">de 0</span><span class="calls num"></span></div>
        </aside>
      </div>
      <div class="p3d-spec"></div>
      <div class="p3d-transport">
        <button class="p3d-play" type="button" aria-label="Reproducir">${ICON_PLAY}</button>
        <span class="p3d-time num">0:00 / 0:00</span>
        <label class="p3d-vol"><span>Volumen</span><input type="range" min="0" max="1" step="0.01" value="1" aria-label="Volumen"></label>
        <button class="btn sm p3d-speed" type="button" aria-pressed="false" aria-label="Velocidad de reproducción">1×</button>
      </div>
      <audio preload="auto" hidden></audio>`;
    parent.appendChild(el);
    const q = s => el.querySelector(s);
    this.q = { src: q(".p3d-src"), badge: q(".p3d-badge"), stage: q(".p3d-stage"), state: q(".p3d-state"), active: q(".p3d-active"), rich: q(".p3d-rich b"), of: q(".p3d-rich .of"), calls: q(".p3d-rich .calls"),
      spec: q(".p3d-spec"), play: q(".p3d-play"), time: q(".p3d-time"), vol: q(".p3d-vol input"), speed: q(".p3d-speed"), color: q(".p3d-colorbtn") };
    this.audio = q("audio");

    // fuentes
    const grupos = {};
    for (const f of fuentes) (grupos[f.grupo] ||= []).push(f);
    this.q.src.innerHTML = Object.entries(grupos).map(([g, fs]) => `<optgroup label="${esc(g)}">${fs.map(f => `<option value="${esc(f.id)}">${esc(f.titulo)}</option>`).join("")}</optgroup>`).join("");
    this.q.src.value = fuenteInicial;

    try { this.scene = new SceneView(this.q.stage); }
    catch (e) { this.scene = null; this.setEstado("Tu navegador no pudo crear la escena WebGL: " + e.message, true); }
    this.spec = new SpecView(this.q.spec, { onSeek: f => this.cb.onSeek(this, f) });

    this._ev = [];
    const on = (t, ev, fn) => { t.addEventListener(ev, fn); this._ev.push([t, ev, fn]); };
    on(this.q.src, "change", () => { this.cb.onSource?.(this, this.q.src.value); this.setFuente(this.q.src.value); });   // elección del usuario
    on(el.querySelector(".p3d-views"), "click", e => { const b = e.target.closest("button[data-v]"); if (b && this.scene) this.scene.vista(b.dataset.v); });
    on(this.q.color, "click", () => { const o = this.scene.alternarColorOriginal(); this.q.color.textContent = o ? "Color por altura" : "Color original"; });
    on(this.q.play, "click", () => this.cb.onPlayToggle(this));
    on(this.q.vol, "input", () => { this.vol = +this.q.vol.value; this.audio.volume = this.vol; });
    on(this.q.speed, "click", () => this.cb.onRate(this, this.rate === 1 ? 2 : 1));
    on(this.audio, "play", () => this.pintarPlay()); on(this.audio, "pause", () => this.pintarPlay()); on(this.audio, "ended", () => this.pintarPlay());
  }

  setEstado(txt, error) { this.q.state.textContent = txt || ""; this.q.state.classList.toggle("on", !!txt); this.q.state.classList.toggle("err", !!error); }
  get duracion() { return this.dataset?.duracion || 0; }
  get reproduciendo() { return !this.audio.paused && !this.audio.ended; }
  get t() { return this.audio.currentTime || 0; }

  async setFuente(id) {
    const src = this.fuentes.find(f => f.id === id); if (!src) return;
    const tok = ++this.tok; this.audio.pause(); this.q.src.value = id;
    this.setEstado("Cargando " + src.titulo + "…");
    try {
      const ds = await cargarFuente(src, { liveBase: this.liveBase, D: this.D });
      if (tok !== this.tok) { URL.revokeObjectURL(ds.url); return; }
      const vieja = this.url; this.url = ds.url; this.dataset = ds;
      this.audio.src = ds.url; this.audio.load(); this.audio.volume = this.vol; this.audio.playbackRate = this.rate; if (vieja) URL.revokeObjectURL(vieja);
      this.q.badge.textContent = ds.demo ? "DEMO · audio sintético" : "Datos reales"; this.q.badge.classList.toggle("demo", ds.demo);
      const unicas = [...new Map(ds.dets.map(d => [d.sci, { sci: d.sci, common: d.common, code: d.code }])).values()];
      this.q.of.textContent = "de " + unicas.length;
      await this.cargarBosque();
      if (tok !== this.tok) return;
      this.scene?.registrarEspecies();
      const esp = await calcularEspectrograma(ds.samples, ds.sr);
      if (tok !== this.tok) return;
      ds.llamadas = ds.demo ? detectarLlamadas(esp, ds.dets, ds.segmentos, { onsets: false }) : detectarTodo(esp, ds.dets, ds.segmentos);   // una marca por cada vez que canta la especie
      this.spec.setData(esp, ds.dets, ds.duracion, ds.llamadas);
      this.setEstado(ds.dets.length ? "" : "Este clip no tiene detecciones dentro de su ventana.");
      this._clave = "~"; this.actualizarTiempo(true);
    } catch (e) {
      if (tok !== this.tok) return;
      if (src.reel && !this._sinSensor) {   // el resumen real no está disponible (p. ej. fuera de la red del sensor): mostrar la demo
        this._sinSensor = true; await this.setFuente("demo:amanecer"); this._sinSensor = false;
        if (this.dataset?.demo) this.q.badge.textContent = "DEMO · sin conexión al sensor";
        return;
      }
      this.dataset = null; this.audio.removeAttribute("src"); this.audio.load(); this.scene?.registrarEspecies([]);   // no dejar datos de la fuente anterior
      this.q.badge.textContent = "Sin datos"; this.q.badge.classList.remove("demo"); this.q.of.textContent = "de 0"; this._clave = "~";
      this.setEstado("No se pudo cargar: " + e.message + (src.demo ? "" : ". Los clips reales no están disponibles en este momento."), true);
    }
  }
  async cargarBosque() {
    if (!this.scene || !this.dataset) return;
    const datos = await getForest(this.dataset.bosque, this.presupuesto);
    this.scene.setForest(datos);
    this.q.color.hidden = !datos.colores;
  }
  async setPresupuesto(n) { if (n === this.presupuesto) return; this.presupuesto = n; await this.cargarBosque(); this.scene?.registrarEspecies(this._unicas()); }
  _unicas() { return [...new Map((this.dataset?.dets || []).map(d => [d.sci, { sci: d.sci, common: d.common, code: d.code }])).values()]; }
  setDatos(D) {   // nuevos datos del dashboard: solo actualiza la lista de fuentes reales
    this.D = D;
  }
  setFuentes(fuentes) {
    this.fuentes = fuentes; const cur = this.q.src.value, grupos = {};
    for (const f of fuentes) (grupos[f.grupo] ||= []).push(f);
    this.q.src.innerHTML = Object.entries(grupos).map(([g, fs]) => `<optgroup label="${esc(g)}">${fs.map(f => `<option value="${esc(f.id)}">${esc(f.titulo)}</option>`).join("")}</optgroup>`).join("");
    this.q.src.value = fuentes.some(f => f.id === cur) ? cur : fuentes[0].id;
  }
  setTema() { this.scene?.aplicarTema(); this.spec.draw(this.t, this._act || new Set(), true); }

  // ── reproductor ────────────────────────────────────────────────────────────
  async reproducir() {
    if (!this.dataset) return;
    if (this.audio.ended || this.t >= this.duracion - 0.05) this.audio.currentTime = 0;
    try { await this.audio.play(); } catch (e) { this.setEstado("El navegador bloqueó la reproducción: " + e.message, true); }
  }
  pausar() { this.audio.pause(); }
  saltar(seg) { if (!this.dataset) return; this.audio.currentTime = clamp(seg, 0, Math.max(0, this.duracion - 0.001)); }
  fijarVelocidad(r) { this.rate = r; this.audio.playbackRate = r; this.q.speed.textContent = r + "×"; this.q.speed.setAttribute("aria-pressed", String(r === 2)); }
  pintarPlay() { const p = this.reproduciendo; this.q.play.innerHTML = p ? ICON_PAUSE : ICON_PLAY; this.q.play.setAttribute("aria-label", p ? "Pausar" : "Reproducir"); this.q.play.classList.toggle("on", p); }
  actualizarTiempo(forzar) {
    const s = fmtTime(this.t) + " / " + fmtTime(this.duracion);
    if (forzar || s !== this._tt) { this._tt = s; this.q.time.textContent = s; }
  }

  // ── fotograma ──────────────────────────────────────────────────────────────
  tick() {
    const t = this.t, dets = this.dataset?.dets || [], evs = this.dataset?.llamadas || dets, activos = [], porEsp = new Map(), vistos = new Set();
    let llamadas = 0;
    for (const d of dets) if (d.t0 <= t) vistos.add(d.sci);
    for (const ev of evs) {   // una etiqueta por cada llamada
      const age = t - ev.t0;
      if (age < 0) continue;
      llamadas++;
      if (age > VIDA_ETIQUETA) continue;
      activos.push({ key: ev.key || `${ev.sci}#${ev.t0}`, sci: ev.sci, code: ev.onset ? ev.code + "?" : ev.code, common: ev.common, conf: ev.conf, age });
      const p = porEsp.get(ev.sci); if (!p) porEsp.set(ev.sci, { ev, n: 1, age, conf: ev.conf }); else { p.n++; if (age < p.age) { p.age = age; p.conf = ev.conf; } }
    }
    this._act = new Set(porEsp.keys());
    this.scene?.actualizarEtiquetas(activos); this.scene?.render();
    this.spec.draw(t, this._act);
    this.actualizarTiempo();
    const clave = [...porEsp].map(([s, a]) => s + a.n + a.conf).join("|") + "#" + vistos.size + "#" + llamadas;
    if (clave !== this._clave) {
      this._clave = clave; this.q.rich.textContent = String(vistos.size); this.q.calls.textContent = llamadas ? `· ${llamadas} llamada${llamadas > 1 ? "s" : ""}` : "";
      const filas = [...porEsp.values()].sort((a, b) => a.age - b.age);
      this.q.active.innerHTML = filas.length ? filas.map(a => `<li><span class="p3d-code">${esc(a.ev.code)}</span><span class="p3d-nm">${esc(a.ev.common)}<i>${esc(a.ev.sci)}</i></span><span class="p3d-cf num" title="Confianza${a.n > 1 ? " · llamadas activas" : ""}">${(+a.conf).toFixed(2)}${a.n > 1 ? ` ×${a.n}` : ""}</span></li>`).join("")
        : `<li class="vacio">Ninguna especie cantando en este instante</li>`;
    }
  }

  dispose() {
    this.tok++; this.audio.pause(); this.audio.removeAttribute("src"); this.audio.load();
    if (this.url) URL.revokeObjectURL(this.url); this.url = null;
    for (const [t, ev, fn] of this._ev) t.removeEventListener(ev, fn);
    this.spec.dispose(); this.scene?.dispose(); this.el.remove(); this.dataset = null;
  }
}
