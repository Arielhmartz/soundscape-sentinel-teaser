// Soundscape Sentinel · teaser congelado.
// Sustituye al servidor del sensor: el "monitor en vivo" reproduce en bucle el resumen de ~5 min del sensor,
// dibuja un recuadro sobre el espectrograma cada vez que canta una especie y programa las detecciones sobre ese mismo audio,
// así que el resto del código del dashboard corre sin cambios.
(() => {
  try { if (!document.documentElement.getAttribute("data-theme")) document.documentElement.setAttribute("data-theme", "dark"); } catch (e) {}

  const REAL_FETCH = window.fetch.bind(window);
  const RATE = 24000; let DUR = 285;   // resumen a 24 kHz en bucle; la duración real viene de reel.json
  const GAIN = 0.05;                                // el micrófono real capta bajo (≈ −50 dBFS); el resumen está normalizado
  const DELAY_MS = 5000;                            // el sensor tarda unos segundos en publicar una detección
  const CHUNK = 2400;                               // 0,1 s
  const COLORES = ["#52d6c1", "#f5a524", "#ff7a90", "#8ab4ff", "#c9a0ff", "#a5e36b"];
  let pcm = null, pcmPromise = null, meta = null, recent = [];
  let eventos = [], eventosPromise = null;
  const S = { on: false, perf0: 0, wall0: 0, k: 0 };

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function cargar() {
    pcmPromise = pcmPromise || (async () => {
      const [jr, ra, dr] = await Promise.all([REAL_FETCH("live/reel.json"), REAL_FETCH("live/reel.mp3"), REAL_FETCH("data.json")]);
      meta = await jr.json(); DUR = meta.duration || DUR; const D = await dr.json(); recent = D.detections?.recent || [];
      const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const buf = await new Ctx(1, 1, RATE).decodeAudioData(await ra.arrayBuffer());
      pcm = buf.getChannelData(0);
    })();
    await pcmPromise;
  }

  // Cantos individuales: mismo detector que la pestaña 3D (cresta de frecuencia de cada especie + picos de energía)
  function calcularEventos() {
    eventosPromise = eventosPromise || (async () => {
      await cargar();
      const base = new URL("paisaje3d/", document.currentScript?.src || new URL("js/teaser-shim.js", location.href)).href;
      const [{ calcularEspectrograma }, { codigo4 }, { detectarTodo }] = await Promise.all([
        import(new URL("spectrogram.js", base).href), import(new URL("../estratos.js", base).href), import(new URL("refine.js", base).href)]);
      // BirdNET corrido sobre este mismo audio: da la especie y los tiempos de cada tramo (dets_bn) y la confianza de cada ventana de 3 s (bn_win)
      const dets = (meta.dets_bn || meta.dets).map(d => ({ id: d.id, sci: d.sci, common: d.common, code: codigo4(d.sci), conf: d.conf, t0: d.t0, t1: d.t1 }));
      const esp = await calcularEspectrograma(pcm, RATE);
      const nombres = [...new Set(dets.map(d => d.sci))], ventanas = meta.bn_win || [];
      eventos = detectarTodo(esp, dets, meta.segmentos).map(e => {
        // confianza propia de cada canto: la mejor ventana de BirdNET de esa especie que lo contiene
        const c = ventanas.filter(w => w.sci === e.sci && w.a - 0.2 <= e.tp && e.tp <= w.b + 0.2).reduce((m, w) => Math.max(m, w.c), 0);
        return { ...e, conf: c > 0 && !e.onset ? c : e.conf, color: COLORES[nombres.indexOf(e.sci) % COLORES.length] };
      });
      window.__teaserEventos = eventos; window.__teaserPcm = pcm;
    })().catch(err => { console.warn("teaser: no se pudieron calcular los cantos", err); });
    return eventosPromise;
  }
  window.addEventListener("load", () => setTimeout(calcularEventos, 1200));

  function pcmResponse(signal) {
    S.on = true; S.k = 0; S.perf0 = performance.now(); S.wall0 = Date.now();
    const loopN = DUR * RATE;
    let parado = false;
    const stream = new ReadableStream({
      start(c) {
        if (signal) signal.addEventListener("abort", () => { parado = true; S.on = false; try { c.error(new DOMException("Aborted", "AbortError")); } catch (e) {} });
      },
      async pull(c) {
        const espera = S.perf0 + S.k * (CHUNK / RATE * 1000) - performance.now();
        if (espera > 0) await sleep(espera);
        else if (espera < -400) S.k += Math.floor(-espera / (CHUNK / RATE * 1000));   // atrasado (pestaña en segundo plano): se salta ese audio en vez de mandarlo en ráfaga
        if (parado) return;
        const i16 = new Int16Array(CHUNK);
        for (let i = 0; i < CHUNK; i++) {
          const v = pcm[(S.k * CHUNK + i) % loopN] * GAIN;
          i16[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32768)));
        }
        S.k++;
        c.enqueue(new Uint8Array(i16.buffer));
      },
      cancel() { parado = true; S.on = false; }
    });
    return new Response(stream, { status: 200, headers: { "X-Sample-Rate": String(RATE), "Content-Type": "application/octet-stream" } });
  }

  // ───── Recuadros sobre el espectrograma ─────
  // Cada recuadro nace en el borde derecho cuando el audio llega al canto y queda fijado a las columnas del espectrograma
  // (LV.cols cuenta las columnas realmente dibujadas, que dependen de los fps): se mueve con ellas y sale por la izquierda.
  // hist guarda (segundo de audio, columnas dibujadas) para ubicar un canto aunque la pestaña haya estado en segundo plano:
  // lo que sonó mientras no se dibujaba nada no está en el espectrograma y no se marca.
  const LANES = 4, LANE_H = 15;
  let capa = null, prevRepro = 0, inst = [], hist = [];
  function reproducidoAhora() {   // segundos de audio ya oídos en esta sesión (sin dar la vuelta al bucle)
    let lead = 0.25;
    try { if (typeof LV !== "undefined" && LV.ctx && LV.next) lead = Math.max(0, LV.next - LV.ctx.currentTime); } catch (e) {}
    return Math.max(0, S.k * CHUNK / RATE - lead);
  }
  function muestrear() {   // se llama desde el dibujo del espectrograma: el segundo de audio y las columnas dibujadas quedan emparejados en el mismo instante
    if (!S.on) return;
    let cols = 0; try { cols = (typeof LV !== "undefined" && LV.cols) || 0; } catch (e) {}
    const rep = reproducidoAhora(), ult = hist[hist.length - 1]; window.__teaserLast = [rep, cols];
    if (!ult || cols !== ult[1] || rep - ult[0] > 0.2) hist.push([rep, cols]);
    while (hist.length > 2 && hist[1][0] < rep - 40) hist.shift();
  }
  window.__teaserTick = muestrear;
  // El espectrograma muestra el audio con un retraso fijo (ventana FFT de 85 ms + suavizado del analizador) y el canto se ve un poco más largo que su detección
  const RETRASO_VISUAL = 0.07, MARGEN_INI = 0.08, MARGEN_FIN = 0.12;
  function colAt(t) {
    if (!hist.length || t < hist[0][0]) return null;
    for (let i = hist.length - 1; i > 0; i--) {
      if (hist[i - 1][0] <= t) { const [ta, ca] = hist[i - 1], [tb, cb] = hist[i]; return tb > ta ? ca + (cb - ca) * Math.min(1, (t - ta) / (tb - ta)) : cb; }
    }
    return hist[hist.length - 1][1];
  }
  function crearCapa() {
    const wrap = document.getElementById("spec-wrap"); if (!wrap) return null;
    capa = document.createElement("div");
    capa.id = "teaser-calls"; capa.setAttribute("aria-hidden", "true");
    capa.style.cssText = "position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:3";
    // nota fija sobre el ruido de fondo (medido en el espectro promedio de todo el resumen: tono a 211 Hz, armónico a 422 Hz y retumbar bajo 200 Hz)
    const nota = document.createElement("div");
    nota.textContent = "Zumbido constante · tono a 211 Hz · posible motor o equipo";
    nota.style.cssText = "position:absolute;left:52px;bottom:6px;max-width:58%;padding:3px 7px;border-radius:3px;border:1px solid rgba(245,165,36,.55);background:rgba(4,18,26,.72);color:#f5c26b;font:600 10.5px/1.3 Exo,system-ui,sans-serif;letter-spacing:.02em";
    capa.appendChild(nota);
    wrap.appendChild(capa); return capa;
  }
  function crearNodo(it) {
    const ev = it.ev, box = document.createElement("div"), lab = document.createElement("div"), lin = document.createElement("div");
    box.style.cssText = `position:absolute;left:0;top:0;box-sizing:border-box;border:2px ${ev.onset ? "dashed" : "solid"} ${ev.color};background:${ev.color}33;box-shadow:0 0 0 1px #04121a88;border-radius:3px;will-change:transform`;
    lab.textContent = ev.onset ? `${ev.common} · probable` : `${ev.common} · ${Math.round(ev.conf * 100)} %`;
    lab.style.cssText = `position:absolute;left:-2px;white-space:nowrap;font:600 11px/1 Exo,system-ui,sans-serif;letter-spacing:.02em;color:#04121a;background:${ev.color};padding:3px 6px;border-radius:3px`;
    lin.style.cssText = `position:absolute;left:-2px;width:2px;background:${ev.color};display:none`;
    box.appendChild(lin); box.appendChild(lab); capa.appendChild(box);
    it.box = box; it.lab = lab; it.lin = lin; it.lw = 0;
  }
  function limpiar() { inst.forEach(it => it.box && it.box.remove()); inst = []; hist = []; prevRepro = 0; if (capa) capa.style.display = "none"; }
  function pintar() {
    requestAnimationFrame(pintar);
    const cv = document.getElementById("live-spec");
    if (!cv || !eventos.length) return;
    if (!S.on) { if (inst.length || hist.length) limpiar(); return; }
    if (!capa || !capa.isConnected) { inst = []; hist = []; if (!crearCapa()) return; }
    capa.style.display = "";
    let cols = 0; try { cols = (typeof LV !== "undefined" && LV.cols) || 0; } catch (e) {}
    const rep = reproducidoAhora();
    if (rep < prevRepro) { limpiar(); capa.style.display = ""; }
    muestrear();
    // cantos que el audio alcanzó desde el cuadro anterior
    eventos.forEach((ev, i) => {
      for (let n = Math.max(0, Math.floor((prevRepro - ev.t0) / DUR) + 1), nmax = Math.floor((rep - ev.t0) / DUR); n <= nmax; n++) {
        const c0 = colAt(ev.t0 + n * DUR + RETRASO_VISUAL - MARGEN_INI);
        inst.push({ ev, id: i + "#" + n, fin: ev.t1 + n * DUR + RETRASO_VISUAL + MARGEN_FIN, c0: c0 === null ? cols : c0, c1: null, lane: 0 });
      }
    });
    prevRepro = rep;
    const W = cv.clientWidth, H = cv.clientHeight, k = W / cv.width, FMAX = 12000, y = f => H * (1 - f / FMAX);
    inst = inst.filter(it => {
      if (it.c1 === null && rep >= it.fin) { const c = colAt(it.fin); it.c1 = c === null ? cols : c; }
      if (it.c1 !== null && it.c1 - it.c0 < 3) { it.box && it.box.remove(); return false; }   // sonó mientras la pestaña no dibujaba: no está en el espectrograma
      it.xi = W - (cols - it.c0) * k; it.xf = it.c1 === null ? W : W - (cols - it.c1) * k;
      if (it.xf < -6) { it.box && it.box.remove(); return false; }   // ya salió del espectrograma
      return true;
    });
    for (const it of inst) {
      const nuevo = !it.box; if (nuevo) crearNodo(it);
      if (nuevo) {   // carril libre para la etiqueta: que no se pise con las de cantos recientes
        it.lw = it.lab.offsetWidth; let lane = 0;
        for (; lane < LANES - 1; lane++) if (!inst.some(e => e !== it && e.box && e.lane === lane && e.xi + e.lw + 6 > it.xi)) break;
        it.lane = lane;
      }
      const f0 = Math.max(0, it.ev.banda[0]), f1 = Math.min(FMAX, it.ev.banda[1]);
      const top = y(f1), alto = Math.max(16, y(f0) - top), debajo = top < 20 + it.lane * LANE_H, dy = 17 + it.lane * LANE_H;
      it.box.style.transform = `translate(${it.xi.toFixed(1)}px,${top.toFixed(1)}px)`;
      it.box.style.width = Math.max(6, it.xf - it.xi).toFixed(1) + "px"; it.box.style.height = alto.toFixed(1) + "px";
      it.box.style.opacity = String(Math.max(0.3, 0.3 + 0.7 * (it.xf / W)));
      const pegada = Math.max(0, Math.min(-it.xi, it.xf - it.lw - 4));   // si el recuadro sale por la izquierda, la etiqueta se queda en el borde mientras quede canto visible
      it.lab.style.left = (pegada - 2).toFixed(1) + "px"; it.lin.style.left = (pegada - 2).toFixed(1) + "px";
      it.lab.style.top = debajo ? "auto" : `-${dy}px`; it.lab.style.bottom = debajo ? `-${dy}px` : "auto";
      if (it.lane > 0) {   // línea que une la etiqueta (en un carril más alto) con su recuadro
        it.lin.style.display = ""; it.lin.style.height = (it.lane * LANE_H + 2) + "px";
        it.lin.style.top = debajo ? "auto" : `-${it.lane * LANE_H + 2}px`; it.lin.style.bottom = debajo ? `-${it.lane * LANE_H + 2}px` : "auto";
      } else it.lin.style.display = "none";
    }
  }
  requestAnimationFrame(pintar);

  // ───── Detecciones simuladas ─────
  const hora = ms => new Date(ms).toLocaleTimeString("es-CL", { hour12: false });
  function detecciones() {
    const ahora = Date.now(), base = S.wall0 || ahora, items = [], largo = DUR * 1000;
    const k1 = Math.floor((ahora - base) / largo);
    for (let k = k1; k >= Math.max(0, k1 - 2); k--) {
      for (const d of (meta?.dets || [])) {
        const hit = base + k * largo + d.t1 * 1000;   // el acierto es el final de la ventana de 3 s
        if (hit + DELAY_MS > ahora) continue;
        items.push({ id: d.id, commonName: d.common, scientificName: d.sci, confidence: d.conf, time: hora(hit), timestamp: new Date(hit).toISOString(),
          modelContributions: [{ firstHitAt: new Date(hit).toISOString() }], _hit: hit });
      }
    }
    items.sort((a, b) => b._hit - a._hit);
    for (const r of recent) {   // las detecciones reales de la captura, para que la tabla no quede corta al iniciar
      if (items.length >= 20) break;
      items.push({ id: r.id, commonName: r.common, scientificName: r.sci, confidence: r.conf, time: (r.dt || "").slice(11, 19), timestamp: r.dt + "-03:00",
        modelContributions: [{ firstHitAt: r.dt + "-03:00" }] });
    }
    return { items };
  }

  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (/\/live\/pcm(\?|$)/.test(url)) { await cargar(); calcularEventos(); return pcmResponse(init && init.signal); }
    if (/\/live\/detections(\?|$)/.test(url)) {
      await cargar().catch(() => {});
      return new Response(JSON.stringify(detecciones()), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return REAL_FETCH(input, init);
  };
})();
