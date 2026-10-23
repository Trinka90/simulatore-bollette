// Lettore XML minimale e veloce per i file open data del Portale Offerte.
// Niente DOM: un file di 10 MB si legge in meno di un secondo anche sul telefono.
// I prefissi di namespace (ns2:TAG) vengono tolti.

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function decodifica(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e] ?? m;
  });
}

/** Nodo: {tag, figli:[], testo}. */
export function leggiXml(xml) {
  const radice = { tag: "#root", figli: [], testo: "" };
  const pila = [radice];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^>]*?)?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    const top = pila[pila.length - 1];
    if (m[1] !== undefined) { top.testo += m[1]; continue; }
    if (m[6] !== undefined) { if (pila.length > 1) top.testo += m[6]; continue; }
    if (!m[3]) continue; // commento o dichiarazione
    const tag = m[3].includes(":") ? m[3].slice(m[3].indexOf(":") + 1) : m[3];
    if (m[2] === "/") {
      if (pila.length > 1) pila.pop();
      continue;
    }
    const nodo = { tag, figli: [], testo: "" };
    top.figli.push(nodo);
    if (m[5] !== "/") pila.push(nodo);
  }
  return radice;
}

/** Scorre gli elementi <tag> di primo livello sotto la radice uno alla volta (meno memoria). */
export function* elementi(xml, tag) {
  const apre = new RegExp(`<(?:[\\w.-]+:)?${tag}[\\s>]`, "g");
  const chiude = new RegExp(`</(?:[\\w.-]+:)?${tag}\\s*>`, "g");
  let m;
  while ((m = apre.exec(xml))) {
    chiude.lastIndex = m.index;
    const c = chiude.exec(xml);
    if (!c) break;
    yield leggiXml(xml.slice(m.index, c.index + c[0].length)).figli[0];
    apre.lastIndex = c.index + c[0].length;
  }
}

// ---- accesso comodo
export const figli = (n, tag) => (n ? n.figli.filter((f) => f.tag === tag) : []);
export const figlio = (n, tag) => (n ? n.figli.find((f) => f.tag === tag) : undefined);
/** Testo di un percorso "A/B/C" (primo nodo trovato), decodificato e ripulito. */
export function testo(n, percorso) {
  let cur = n;
  for (const p of percorso.split("/")) { cur = figlio(cur, p); if (!cur) return null; }
  const t = decodifica(cur.testo).trim();
  return t === "" ? null : t;
}
export function testi(n, percorso) {
  const parti = percorso.split("/");
  let livello = [n];
  for (const p of parti) livello = livello.flatMap((x) => figli(x, p));
  return livello.map((x) => decodifica(x.testo).trim()).filter(Boolean);
}
export function numero(n, percorso) {
  const t = testo(n, percorso);
  if (t == null) return null;
  const v = parseFloat(t.replace(",", "."));
  return Number.isFinite(v) ? v : null;
}
/** Cerca in profondità il primo elemento il cui nome soddisfa il test. */
export function trova(n, test) {
  for (const f of n.figli) {
    if (test(f.tag)) return f;
    const r = trova(f, test);
    if (r) return r;
  }
  return null;
}
