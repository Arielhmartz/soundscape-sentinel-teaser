// Pestaña "Paisaje 3D-experimental": orquesta paneles, modo comparación y el bucle de render.
// API para index.html: mount({root, data, liveBase}), leave().
import { listarFuentes } from "./sources.js";
import { Panel } from "./panel.js";
import { liberarCacheBosque } from "./forest.js";
import { liberarDemos } from "./demo.js";

const P_UNO = 110000, P_DOS = 70000;   // puntos por escena (siempre < 200 000 en total)
const guardado = { comparar: false, srcA: null, srcB: "demo:mediodia", sync: true, tocado: false };   // se recuerda mientras la página siga abierta
let S = null;

export function mount({ root, data, liveBase }) {
  if (S) { actualizar(data); return; }
  const fuentes = listarFuentes(data);
  if (!guardado.tocado) guardado.srcA = fuentes.some(f => f.id === "real:reel") ? "real:reel" : "demo:amanecer";   // por defecto: datos reales si los hay
  root.innerHTML = `
    <div class="p3d-bar">
      <button class="btn p3d-cmp" type="button" aria-pressed="false">Comparar dos paneles</button>
      <div class="p3d-cmpctl" hidden>
        <button class="btn p3d-both" type="button">▶ Reproducir ambos</button>
        <label class="p3d-check"><input type="checkbox" class="p3d-sync"> <span>Sincronizar</span></label>
      </div>
      <span class="p3d-hint">Arrastra para orbitar · rueda para acercar · clic en el espectrograma para saltar</span>
    </div>
    <div class="p3d-grid"></div>`;
  S = { root, liveBase, D: data, panels: [], raf: 0, visible: true, ev: [] };
  const q = s => root.querySelector(s);
  S.q = { cmp: q(".p3d-cmp"), ctl: q(".p3d-cmpctl"), both: q(".p3d-both"), sync: q(".p3d-sync"), grid: q(".p3d-grid") };
  S.q.sync.checked = guardado.sync;
  const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); S.ev.push([t, ev, fn, o]); };

  const syncActivo = () => guardado.comparar && S.q.sync.checked && S.panels.length > 1;
  const cb = {
    onPlayToggle: p => {
      if (syncActivo()) { const alguno = S.panels.some(x => x.reproduciendo); S.panels.forEach(x => (alguno ? x.pausar() : x.reproducir())); }
      else if (p.reproduciendo) p.pausar(); else p.reproducir();
    },
    onSeek: (p, frac) => {
      const seg = frac * p.duracion;
      if (syncActivo()) S.panels.forEach(x => x.saltar(seg)); else p.saltar(seg);
    },
    onRate: (p, r) => { if (syncActivo()) S.panels.forEach(x => x.fijarVelocidad(r)); else p.fijarVelocidad(r); },
    onSource: (p, id) => { guardado[S.panels[0] === p ? "srcA" : "srcB"] = id; guardado.tocado = true; },
  };
  const nuevoPanel = (etiqueta, fuenteInicial, presupuesto, compacto) =>
    new Panel(S.q.grid, { etiqueta, fuentes, fuenteInicial, liveBase, D: data, presupuesto, compacto, callbacks: cb });

  const A = nuevoPanel(guardado.comparar ? "A" : "Escena", guardado.srcA, guardado.comparar ? P_DOS : P_UNO, guardado.comparar);
  S.panels.push(A);
  A.setFuente(guardado.srcA);
  if (guardado.comparar) crearB(nuevoPanel);
  pintarComparar();

  on(S.q.cmp, "click", () => alternarComparar(nuevoPanel));
  on(S.q.sync, "change", () => { guardado.sync = S.q.sync.checked; });
  on(S.q.both, "click", () => { const alguno = S.panels.some(x => x.reproduciendo); S.panels.forEach(x => (alguno ? x.pausar() : x.reproducir())); });

  // pausar el render cuando la pestaña del navegador o la sección no se ven
  on(document, "visibilitychange", () => { vivo(); });
  if ("IntersectionObserver" in window) {
    S.io = new IntersectionObserver(es => { S.visible = es[es.length - 1].isIntersecting; vivo(); }, { threshold: 0 });
    S.io.observe(root);
  }
  vivo();
}

function crearB(nuevoPanel) {
  const B = nuevoPanel("B", guardado.srcB, P_DOS, true);
  S.panels.push(B); B.setFuente(guardado.srcB);
  return B;
}
async function alternarComparar(nuevoPanel) {
  guardado.comparar = !guardado.comparar;
  const [A] = S.panels;
  if (guardado.comparar) {
    A.el.classList.add("compacto"); A.el.querySelector(".p3d-tagpanel").textContent = "A";
    crearB(nuevoPanel); await A.setPresupuesto(P_DOS);
  } else {
    S.panels.slice(1).forEach(p => p.dispose()); S.panels.length = 1;
    A.el.classList.remove("compacto"); A.el.querySelector(".p3d-tagpanel").textContent = "Escena";
    await A.setPresupuesto(P_UNO);
  }
  pintarComparar();
}
function pintarComparar() {
  const c = guardado.comparar;
  S.q.cmp.setAttribute("aria-pressed", String(c)); S.q.cmp.textContent = c ? "Volver a un panel" : "Comparar dos paneles";
  S.q.ctl.hidden = !c; S.q.grid.classList.toggle("cmp", c);
}

function actualizar(data) {
  S.D = data;
  const fuentes = listarFuentes(data);
  for (const p of S.panels) {
    p.setDatos(data);
    const antes = p.q.src.value; p.setFuentes(fuentes);
    if (p.q.src.value !== antes) p.setFuente(p.q.src.value);
    p.setTema();
  }
}

// ── bucle ────────────────────────────────────────────────────────────────────
function frame() {
  S.raf = requestAnimationFrame(frame);
  const [A, B] = S.panels;
  if (B && guardado.sync && A.reproduciendo && B.reproduciendo && Math.abs(A.t - B.t) > 0.3) B.saltar(A.t);   // A es el reloj maestro
  for (const p of S.panels) p.tick();
}
function vivo() {
  if (!S) return;
  const correr = !document.hidden && S.visible;
  if (correr && !S.raf) S.raf = requestAnimationFrame(frame);
  else if (!correr && S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; }
}

// Al salir de la pestaña: libera audio, WebGL, listeners y memoria
export function leave() {
  if (!S) return;
  if (S.raf) cancelAnimationFrame(S.raf);
  S.io?.disconnect();
  for (const [t, ev, fn, o] of S.ev) t.removeEventListener(ev, fn, o);
  S.panels.forEach(p => p.dispose());
  S.root.innerHTML = "";
  liberarCacheBosque(); liberarDemos();
  S = null;
}
export const montado = () => !!S;
export const _estado = () => S;   // solo para pruebas / depuración
