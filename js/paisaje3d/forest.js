// Nube de puntos del bosque: escaneo propio (assets/bosque.ply) o bosque procedural.
// Convención: Y es vertical. `h` = altura normalizada 0..1 de cada punto (para colorear).
import { mulberry32, gauss, clamp } from "./util.js";
import { PLY_CONFIG } from "../estratos.js";

const R = 38;   // radio del terreno procedural (m)
const terreno = (x, z) => 0.7 * Math.sin(x * 0.11) * Math.cos(z * 0.09) + 0.35 * Math.sin(x * 0.27 + z * 0.19);

function finalizar(pos, extra) {
  const N = pos.length / 3;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < N; i++) { const y = pos[3 * i + 1]; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const alto = Math.max(1e-6, maxY - minY), h = new Float32Array(N);
  for (let i = 0; i < N; i++) h[i] = (pos[3 * i + 1] - minY) / alto;
  return { pos, h, count: N, base: minY, alto, colores: null, ...extra };
}

export function bosqueProcedural(tipo = "nativo", presupuesto = 100000) {
  const plantacion = tipo === "plantacion";
  const rng = mulberry32(plantacion ? 4242 : 1337);
  const pos = new Float32Array(presupuesto * 3);
  let n = 0;
  const push = (x, y, z) => { if (n < presupuesto) { pos[3 * n] = x; pos[3 * n + 1] = y; pos[3 * n + 2] = z; n++; } };

  // 1) suelo
  const nSuelo = Math.floor(presupuesto * (plantacion ? 0.18 : 0.12));
  for (let i = 0; i < nSuelo; i++) {
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * R, x = Math.cos(a) * r, z = Math.sin(a) * r;
    push(x, terreno(x, z) + Math.abs(gauss(rng)) * 0.04, z);
  }
  // 2) sotobosque (arbustos): denso en el bosque nativo, casi ausente en la plantación
  const nSoto = Math.floor(presupuesto * (plantacion ? 0.03 : 0.17)), arbustos = plantacion ? 18 : 70;
  for (let a = 0; a < arbustos; a++) {
    const ang = rng() * Math.PI * 2, r = Math.sqrt(rng()) * R * 0.95, cx = Math.cos(ang) * r, cz = Math.sin(ang) * r;
    const alto = 0.6 + rng() * 1.8, ancho = 0.5 + rng() * 0.9, por = Math.floor(nSoto / arbustos);
    for (let k = 0; k < por; k++) {
      const x = cx + gauss(rng) * ancho * 0.5, z = cz + gauss(rng) * ancho * 0.5;
      push(x, terreno(x, z) + clamp(Math.abs(gauss(rng)) * 0.5, 0, 1) * alto, z);
    }
  }
  // 3) árboles
  const arboles = [];
  if (plantacion) {            // filas regulares, altura pareja, copa cónica
    for (let gx = -R; gx <= R; gx += 5.2) for (let gz = -R; gz <= R; gz += 5.2) {
      const x = gx + gauss(rng) * 0.25, z = gz + gauss(rng) * 0.25;
      if (Math.hypot(x, z) < R * 0.98) arboles.push({ x, z, h: 21 + gauss(rng) * 1.2, cr: 2.1 + rng() * 0.4, tr: 0.22 + rng() * 0.06 });
    }
  } else {                     // distribución irregular, alturas mezcladas, copas redondeadas
    let intentos = 0;
    while (arboles.length < 46 && intentos++ < 4000) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * R * 0.96, x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (arboles.some(t => Math.hypot(t.x - x, t.z - z) < 4.2)) continue;
      const h = 14 + Math.pow(rng(), 1.6) * 16;
      arboles.push({ x, z, h, cr: 2.6 + h * 0.13 + rng() * 0.8, tr: 0.22 + h * 0.012 + rng() * 0.1 });
    }
  }
  const porArbol = Math.floor((presupuesto - n) / Math.max(1, arboles.length));
  for (const t of arboles) {
    const y0 = terreno(t.x, t.z), nTronco = Math.floor(porArbol * 0.3), nCopa = porArbol - nTronco;
    for (let k = 0; k < nTronco; k++) {
      const u = rng() * (plantacion ? 0.88 : 0.92), ang = rng() * Math.PI * 2, rad = t.tr * (1 - 0.45 * u) * (0.85 + rng() * 0.3);
      push(t.x + Math.cos(ang) * rad, y0 + u * t.h, t.z + Math.sin(ang) * rad);
    }
    if (plantacion) {
      for (let k = 0; k < nCopa; k++) {
        const u = 0.38 + rng() * 0.62, rad = t.cr * (1 - (u - 0.38) / 0.62) * Math.sqrt(rng()), ang = rng() * Math.PI * 2;
        push(t.x + Math.cos(ang) * rad, y0 + u * t.h, t.z + Math.sin(ang) * rad);
      }
    } else {
      for (let k = 0; k < nCopa; k++) {
        const lobo = k % 3, cx = t.x + (lobo === 1 ? 0.5 : lobo === 2 ? -0.4 : 0) * t.cr, cy = y0 + t.h * (0.68 + 0.1 * lobo);
        push(cx + gauss(rng) * t.cr * 0.45, cy + gauss(rng) * t.cr * 0.35, t.z + gauss(rng) * t.cr * 0.45);
      }
    }
  }
  return finalizar(pos.slice(0, n * 3), { origen: "procedural", tipo, radio: R });
}

// ── PLY propio ────────────────────────────────────────────────────────────────
let plyPromesa = null;   // se intenta una sola vez por sesión
// ¿Existe el archivo? Se mira el listado de la carpeta (assets/) en vez de pedir el archivo a ciegas,
// para no dejar un error 404 en la consola cuando no hay .ply. Con ?ply=ruta/archivo.ply se fuerza una ruta concreta.
async function existePLY(ruta) {
  if (new URLSearchParams(location.search).has("ply")) return true;
  try {
    const i = ruta.lastIndexOf("/"), carpeta = i >= 0 ? ruta.slice(0, i + 1) : "./", archivo = ruta.slice(i + 1);
    const r = await fetch(carpeta, { cache: "no-store" });
    return r.ok && (await r.text()).includes(archivo);
  } catch (e) { return false; }
}
async function leerPLY() {
  try {
    const ruta = new URLSearchParams(location.search).get("ply") || PLY_CONFIG.ruta;
    if (!(await existePLY(ruta))) return null;
    const { PLYLoader } = await import("three/addons/loaders/PLYLoader.js");
    return await new PLYLoader().loadAsync(ruta);
  } catch (e) { return null; }
}
function prepararPLY(geo, presupuesto) {
  const pa = geo.attributes.position, ca = geo.attributes.color, N = pa.count;
  const paso = Math.max(1, N / Math.min(presupuesto, PLY_CONFIG.maxPuntos, 190000)), M = Math.floor(N / paso);
  const pos = new Float32Array(M * 3), col = ca ? new Float32Array(M * 3) : null;
  const k = PLY_CONFIG.escala || 1, zUp = PLY_CONFIG.ejeVertical !== "y";
  let sx = 0, sz = 0;
  for (let j = 0; j < M; j++) {
    const i = Math.min(N - 1, Math.floor(j * paso));
    const x = pa.getX(i) * k, y = pa.getY(i) * k, z = pa.getZ(i) * k;
    // Y vertical: si el archivo es Z-up, (x, y, z) → (x, z, −y)
    const X = x, Y = zUp ? z : y, Z = zUp ? -y : z;
    pos[3 * j] = X; pos[3 * j + 1] = Y; pos[3 * j + 2] = Z; sx += X; sz += Z;
    if (col) { col[3 * j] = ca.getX(i); col[3 * j + 1] = ca.getY(i); col[3 * j + 2] = ca.getZ(i); }
  }
  const cx = sx / M, cz = sz / M, rs = [];
  for (let j = 0; j < M; j++) { pos[3 * j] -= cx; pos[3 * j + 2] -= cz; if (j % 7 === 0) rs.push(Math.hypot(pos[3 * j], pos[3 * j + 2])); }
  rs.sort((a, b) => a - b);
  return finalizar(pos, { origen: "ply", tipo: "ply", radio: Math.max(5, rs[Math.floor(rs.length * 0.95)] || 20), colores: col });
}

const cache = new Map();
// Devuelve los datos del bosque. Prioridad: assets/bosque.ply → procedural.
export async function getForest(tipo, presupuesto) {
  if (plyPromesa === null) plyPromesa = leerPLY();
  const geo = await plyPromesa;
  const clave = (geo ? "ply:" : tipo + ":") + presupuesto;
  if (!cache.has(clave)) cache.set(clave, geo ? prepararPLY(geo, presupuesto) : bosqueProcedural(tipo, presupuesto));
  return cache.get(clave);
}
export function liberarCacheBosque() { cache.clear(); plyPromesa = null; }   // al salir de la pestaña
