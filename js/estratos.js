// ─────────────────────────────────────────────────────────────────────────────
// Tabla EDITABLE del visor "Paisaje 3D-experimental".
//
// Con un solo micrófono no hay localización acústica real: la posición de cada
// etiqueta es ILUSTRATIVA. La altura sale del estrato típico de la especie y la
// posición horizontal sale de una semilla fija por especie (siempre el mismo lugar).
// ─────────────────────────────────────────────────────────────────────────────
import { mulberry32, hashStr, lerp } from "./paisaje3d/util.js";

// Nube de puntos propia (LiDAR / Polycam). Si existe el archivo se usa en lugar del bosque procedural.
export const PLY_CONFIG = {
  ruta: "assets/bosque.ply",
  ejeVertical: "z",     // "z" (típico de LiDAR) o "y" (típico de Polycam / glTF)
  escala: 1,            // metros por unidad del archivo
  maxPuntos: 150000,    // se submuestrea si el archivo trae más (tope duro del visor: 200 000 en total)
};

// Estratos: rango de altura como FRACCIÓN de la altura del bosque (1.0 = copa más alta).
export const ESTRATOS = {
  suelo:       { etiqueta: "Suelo / sotobosque", alt: [0.02, 0.14] },
  dosel_medio: { etiqueta: "Dosel medio",        alt: [0.38, 0.65] },
  dosel_alto:  { etiqueta: "Dosel alto",         alt: [0.74, 0.95] },
  aereo:       { etiqueta: "Aéreo",              alt: [1.12, 1.55] },
};
export const ESTRATO_DEFECTO = "dosel_medio";

// Especies (nombre científico → estrato). `banda` = rango típico de frecuencia en Hz (caja en el espectrograma).
export const ESPECIES = {
  "Turdus falcklandii":       { estrato: "suelo",       banda: [1800, 4200] },   // Zorzal Patagón
  "Elaenia albiceps":         { estrato: "dosel_medio", banda: [3000, 5200] },   // Fiofío Crestiblanco
  "Zonotrichia capensis":     { estrato: "suelo",       banda: [3000, 6200] },   // Chincol
  "Sephanoides sephaniodes":  { estrato: "dosel_medio", banda: [5500, 8200] },   // Picaflor Chico
  "Pteroptochos tarnii":      { estrato: "suelo",       banda: [600, 1800] },    // Hued-hued del Sur
  "Scelorchilus rubecula":    { estrato: "suelo",       banda: [1200, 2800] },   // Chucao
  "Aphrastura spinicauda":    { estrato: "dosel_medio", banda: [3200, 6600] },   // Rayadito
  "Campephilus magellanicus": { estrato: "dosel_alto",  banda: [500, 6500] },    // Carpintero Negro
  "Enicognathus ferrugineus": { estrato: "dosel_alto",  banda: [1800, 5200] },   // Cachaña
  "Tachycineta meyeni":       { estrato: "aereo",       banda: [2800, 5800] },   // Golondrina Chilena
  "Anairetes parulus":        { estrato: "suelo",       banda: [4800, 7800] },   // Cachudito
  "Columba araucana":         { estrato: "dosel_alto",  banda: [300, 1200] },    // Torcaza
  "Milvago chimango":         { estrato: "aereo",       banda: [1500, 4500] },   // Tiuque
  "Troglodytes aedon":        { estrato: "suelo",       banda: [2500, 7000] },   // Chercán
  "Curaeus curaeus":          { estrato: "dosel_medio", banda: [1500, 4500] },   // Tordo
};
export const BANDA_DEFECTO = [1500, 9000];

// Códigos de 4 letras: por defecto 2 letras del género + 2 de la especie (Turdus falcklandii → TUFA).
// Si dos especies chocan, fuerza el código aquí.
export const CODIGOS = {
  // "Genero especie": "XXXX",
};

export function codigo4(sci) {
  if (CODIGOS[sci]) return CODIGOS[sci];
  const [g = "", s = ""] = String(sci || "").trim().split(/\s+/);
  return (g.slice(0, 2) + s.slice(0, 2)).toUpperCase().padEnd(4, "·");
}
export const estratoDe = sci => ESPECIES[sci]?.estrato || ESTRATO_DEFECTO;
export const bandaDe = sci => ESPECIES[sci]?.banda || BANDA_DEFECTO;

// Posición ilustrativa: horizontal con semilla fija por especie, vertical según su estrato.
// `radio` = radio del bosque, `base`/`alto` = suelo y altura del bosque (mismas unidades que la nube).
export function posicionIlustrativa(sci, radio, base, alto) {
  const rng = mulberry32(hashStr("pos:" + sci));
  const ang = rng() * Math.PI * 2, r = Math.sqrt(rng()) * radio * 0.68;
  const [a0, a1] = ESTRATOS[estratoDe(sci)].alt;
  const frac = lerp(a0, a1, rng());
  return { x: Math.cos(ang) * r, y: base + frac * alto, z: Math.sin(ang) * r };
}
