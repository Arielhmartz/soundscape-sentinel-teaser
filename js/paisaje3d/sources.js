// Fuentes de audio + detecciones: demo (sintético) o datos reales de data.json (clips del sensor).
import { generarDemo, DEMOS } from "./demo.js";
import { codigo4 } from "../estratos.js";

const VENTANA = 6;       // s: los clips del sensor duran 12 s con la detección en el centro
const VENTANA_DET = 3;   // s: ventana de análisis de cada detección

export function listarFuentes(D) {
  const f = Object.entries(DEMOS).map(([k, v]) => ({ id: "demo:" + k, grupo: "Demo (audio sintético)", titulo: "Demo · " + v.titulo, demo: true }));
  if ((D?.detections?.recent || []).length) f.unshift({ id: "real:reel", grupo: "Datos reales del sensor", titulo: "Resumen reciente · últimas detecciones unidas (≈5 min)", demo: false, reel: true });
  for (const r of D?.detections?.recent || []) {
    const fecha = new Date(r.dt).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "medium" });
    f.push({ id: "real:" + r.id, grupo: "Datos reales del sensor", titulo: `${r.common} · ${fecha}`, demo: false, det: r });
  }
  return f;
}

async function decodificar(bytes) {
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new Ctx(1, 1, 48000);                       // solo decodifica: no requiere gesto del usuario
  const buf = await ctx.decodeAudioData(bytes.slice(0));
  return { samples: buf.getChannelData(0), sr: buf.sampleRate, duracion: buf.duration };
}

// Devuelve un dataset: {id, titulo, demo, bosque, samples, sr, duracion, url, dets[], sitio}
export async function cargarFuente(src, { liveBase, D }) {
  if (src.demo) {
    const g = generarDemo(src.id.slice(5)), dec = await decodificar(g.wav);
    const url = URL.createObjectURL(new Blob([g.wav], { type: "audio/wav" }));
    return { id: src.id, titulo: g.titulo, demo: true, bosque: g.bosque, url, dets: g.dets, ...dec };
  }
  if (src.reel) {   // ~20 clips de detección unidos por el sensor en un solo audio, con los tiempos de cada especie
    const jr = await fetch(`${liveBase}/live/reel.json?n=20&min=0.5`);
    const meta = await jr.json().catch(() => ({}));
    if (!jr.ok || !meta.ok || !meta.dets?.length) throw new Error(meta.error || `el sensor no pudo armar el resumen (HTTP ${jr.status})`);
    const ra = await fetch(liveBase + meta.audio);
    if (!ra.ok) throw new Error(`no se pudo descargar el audio (HTTP ${ra.status})`);
    const bytes = await ra.arrayBuffer(), dec = await decodificar(bytes);
    const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
    const dets = (meta.dets_bn || meta.dets).map(d => ({ sci: d.sci, common: d.common, code: codigo4(d.sci), conf: d.conf, t0: d.t0, t1: Math.min(dec.duracion, d.t1) }));
    return { id: src.id, titulo: `Resumen reciente · ${meta.clips} clips`, demo: false, bosque: "nativo", url, dets, segmentos: meta.segmentos, sitio: D?.meta?.site?.name, ...dec };
  }
  const r0 = src.det, res = await fetch(`${liveBase}/live/clip/${encodeURIComponent(r0.id)}.mp3`);
  if (!res.ok) throw new Error(`no se pudo descargar el clip (HTTP ${res.status})`);
  const bytes = await res.arrayBuffer(), dec = await decodificar(bytes);
  const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" })), centro = dec.duracion / 2, t0c = new Date(r0.dt).getTime();
  // detecciones de data.json que caen dentro de la ventana del clip (± 6 s alrededor de la principal)
  const dets = [];
  for (const r of D?.detections?.recent || []) {
    const dt = (new Date(r.dt).getTime() - t0c) / 1000;
    if (Math.abs(dt) > VENTANA) continue;
    const t0 = Math.max(0, centro + dt - VENTANA_DET / 2);
    if (t0 >= dec.duracion) continue;
    dets.push({ sci: r.sci, common: r.common, code: codigo4(r.sci), conf: r.conf, t0, t1: Math.min(dec.duracion, t0 + VENTANA_DET) });
  }
  dets.sort((a, b) => a.t0 - b.t0);
  return { id: src.id, titulo: src.titulo, demo: false, bosque: "nativo", url, dets, sitio: D?.meta?.site?.name, ...dec };
}
