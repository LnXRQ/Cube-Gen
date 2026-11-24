// Cube Draft fürs iPhone: Cubes offline aufs Handy laden, gegen Bots draften, Deck bauen,
// Drafts als Datei zurück an den PC (Ordner „handy“ im Cube-Gen-Ordner, über OneDrive).
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const pause = ms => new Promise(r => setTimeout(r, ms));
const SCRYFALL = "https://api.scryfall.com";
const BILDER = "karten-bilder-v1";
const FARBEN = {W: "var(--W)", U: "var(--U)", B: "var(--B)", R: "var(--R)", G: "var(--G)"};
const BASIS = {W: "Plains", U: "Island", B: "Swamp", R: "Mountain", G: "Forest"};
const ICON = {
  commander: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z"/></svg>`,
  vintage: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 3h2v2L10.5 15.5l-2-2z"/><path d="M6 12l6 6M7.5 16.5L4 20"/><circle cx="3.6" cy="20.4" r="1"/></svg>`,
  ok: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  laden: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>`,
  datei: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>`,
  paket: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 22V12M21 7l-9 5-9-5"/></svg>`,
  weg: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  offline: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 2l20 20"/><path d="M7 18a4.5 4.5 0 0 1-.6-8.96 6 6 0 0 1 1.7-3.1M11 6.2A6 6 0 0 1 18 8.5a4 4 0 0 1 2 7.2"/></svg>`,
  mehr: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>`,
  stern: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.6 6.9L22 12l-7.4 3.1L12 22l-2.6-6.9L2 12l7.4-3.1z"/></svg>`,
};

// ================================================================ Speicher auf dem iPhone (IndexedDB)
const DB = await new Promise((ok, nein) => {
  const r = indexedDB.open("cubegen-handy", 1);
  r.onupgradeneeded = () => {
    r.result.createObjectStore("cubes", {keyPath: "id"});
    r.result.createObjectStore("drafts", {keyPath: "id"});
  };
  r.onsuccess = () => ok(r.result);
  r.onerror = () => nein(r.error);
});
function speicher(store, modus, fn) {
  return new Promise((ok, nein) => {
    const t = DB.transaction(store, modus), s = t.objectStore(store);
    const r = fn(s);
    t.oncomplete = () => ok(r && "result" in r ? r.result : undefined);
    t.onerror = () => nein(t.error);
  });
}
const alle = store => speicher(store, "readonly", s => s.getAll());
const lege = (store, obj) => speicher(store, "readwrite", s => s.put(obj));
const loesche = (store, id) => speicher(store, "readwrite", s => s.delete(id));
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}

// ================================================================ Draft-Motor (draft.py per Pyodide im Hintergrund)
const motor = new Worker("motor.js");
let auftrag = 0;
const wartet = new Map();
motor.onmessage = ev => {
  const {n, ok, r, fehler} = ev.data, w = wartet.get(n);
  wartet.delete(n);
  if (w) ok ? w.ok(JSON.parse(r)) : w.nein(new Error(fehler));
};
motor.onerror = ev => { for (const w of wartet.values()) w.nein(new Error(ev.message || "Der Draft-Motor ist abgestürzt.")); wartet.clear(); };
const rufe = (op, daten) => new Promise((ok, nein) => { const n = ++auftrag; wartet.set(n, {ok, nein}); motor.postMessage({n, op, daten}); });
let motorBereit = false;
rufe("bereit").then(() => { motorBereit = true; }).catch(e => hinweis("Draft-Motor startet nicht: " + e.message, 6000));

// ================================================================ Zustand und kleine Helfer
const S = {cubes: [], drafts: [], wahl: null, z: null, a: null, draftId: null, auswahl: [], laedt: new Map(), D: null, ansicht: "start"};
const norm = n => String(n || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’`]/g, "'").toLowerCase().trim();
const vorne = n => String(n || "").split(" // ")[0];
let hinweisUhr = null;
function hinweis(text, ms = 2600) {
  const h = $("#hinweis");
  h.textContent = text; h.hidden = false;
  clearTimeout(hinweisUhr); hinweisUhr = setTimeout(() => { h.hidden = true; }, ms);
}
function zeige(name) {
  S.ansicht = name;
  for (const v of ["start", "draft", "deck", "bots"]) $("#" + v).hidden = v !== name;
}
function blatt(html) {
  $("#blatt_inhalt").innerHTML = html;
  $("#blatt").hidden = $("#schleier").hidden = false;
  return $("#blatt_inhalt");
}
function blattZu() { $("#blatt").hidden = $("#schleier").hidden = true; $("#blatt_inhalt").innerHTML = ""; }
$("#schleier").onclick = blattZu;
const pipsHtml = farben => `<span class="pips">${[...(farben || "")].filter(c => FARBEN[c]).map(c => `<i style="background:${FARBEN[c]}"></i>`).join("")}</span>`;

function karteHtml(k, klasse = "", extra = "") {
  const bild = k.bild ? `<img src="${esc(k.bild)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : "";
  const holo = k.holo ? `<i class="foil"></i><span class="stern" aria-hidden="true">${ICON.stern}</span>` : "";
  return `<button type="button" class="karte ${klasse}" data-id="${esc(k.id)}" aria-label="${esc(k.name)}${k.holo ? ", Holo" : ""}">
    <span class="ersatz"><b>${esc(vorne(k.name))}</b><small>${esc(k.mana || "")}</small><small>${esc(k.typ || "")}</small></span>${bild}${holo}${extra}</button>`;
}

// Lange drücken zeigt die Karte groß
let druckUhr = null, gezoomt = false;
function lupe(wurzel, finde) {
  wurzel.addEventListener("touchstart", ev => {
    const el = ev.target.closest(".karte"); if (!el) return;
    gezoomt = false;
    druckUhr = setTimeout(() => { const k = finde(el.dataset.id); if (k) { gezoomt = true; zoom(k); } }, 430);
  }, {passive: true});
  for (const t of ["touchend", "touchmove", "touchcancel"]) wurzel.addEventListener(t, () => clearTimeout(druckUhr), {passive: true});
  wurzel.addEventListener("contextmenu", ev => ev.preventDefault());
}
function zoom(k) {
  if (!k) return;
  const text = `<div class="ersatz-gross"><b>${esc(k.name)}</b><span>${esc(k.mana || "")} · ${esc(k.typ || "")}</span><span>${esc(k.text || "").replace(/\n/g, "<br>")}</span></div>`;
  const seite = u => `<div class="zoom-karte">${text}${u ? `<img src="${esc(u)}" alt="${esc(k.name)}" onerror="this.remove()">` : ""}</div>`;
  $("#zoom").innerHTML = seite(k.bild) + (k.bild_rueck ? seite(k.bild_rueck) : "");
  $("#zoom").classList.toggle("zwei", !!k.bild_rueck);
  $("#zoom").hidden = false;
}
$("#zoom").onclick = () => { $("#zoom").hidden = true; };

// ================================================================ Start
async function ladeAlles() {
  S.cubes = (await alle("cubes")).sort((a, b) => (b.zeit_geladen || 0) - (a.zeit_geladen || 0));
  S.drafts = (await alle("drafts")).sort((a, b) => b.aktualisiert - a.aktualisiert);
  if (!S.cubes.some(c => c.id === S.wahl)) S.wahl = (S.cubes[0] || {}).id || null;
}
function cubeInfo(c) {
  const fmt = c.format === "commander" ? "Commander" : "Vintage";
  const l = S.laedt.get(c.id);
  if (l) return `${esc(l.text)}<span class="balken"><i style="width:${Math.round(100 * l.wert / Math.max(1, l.gesamt))}%"></i></span>`;
  const b = c.bilder || {};
  return `${fmt} · ${c.karten.length}${b.gesamt && b.da < b.gesamt ? ` · Bilder ${b.da}/${b.gesamt}` : ""}`;
}
function zeichneStart() {
  zeige("start");
  $("#cubes").innerHTML = S.cubes.length ? S.cubes.map(c => {
    const b = c.bilder || {}, komplett = b.gesamt && b.da >= b.gesamt;
    return `<div class="cube" data-cube="${esc(c.id)}" role="button" tabindex="0" aria-pressed="${c.id === S.wahl}">
      <span class="cube-icon">${c.format === "commander" ? ICON.commander : ICON.vintage}</span>
      <span class="cube-text"><b>${esc(c.name)}</b><span>${cubeInfo(c)}</span></span>
      <span class="cube-status ${komplett ? "ok" : ""}" title="${komplett ? "offline bereit" : "Bilder fehlen noch"}">${S.laedt.has(c.id) ? "" : komplett ? ICON.ok : ICON.laden}</span>
      <button type="button" class="cube-mehr" data-menue="${esc(c.id)}" aria-label="Mehr zu ${esc(c.name)}">${ICON.mehr}</button></div>`;
  }).join("") : `<p class="klein-text">Noch kein Cube auf dem iPhone. Tippe auf „Cube laden“.</p>`;
  const offen = S.drafts.slice(0, 8);
  $("#laufend").innerHTML = offen.length ? `<p class="abschnitt">Deine Drafts</p><div class="drafts">${offen.map(d => `
    <div class="draft-zeile" data-draft="${esc(d.id)}" role="button" tabindex="0">
      <span><b>${esc(d.name)}</b><small>${esc(d.stand || "")} · ${new Date(d.zeit).toLocaleDateString("de-DE", {day: "2-digit", month: "2-digit"})}</small></span>
      ${d.aktualisiert > (d.exportiert || 0) ? `<em>neu</em>` : ""}
      <button type="button" class="weg" data-weg="${esc(d.id)}" aria-label="Draft löschen">${ICON.weg}</button></div>`).join("")}</div>` : "";
  const neu = S.drafts.filter(d => d.aktualisiert > (d.exportiert || 0)).length;
  $("#sync_zahl").hidden = !neu; $("#sync_zahl").textContent = neu;
  const c = S.cubes.find(x => x.id === S.wahl);
  $("#los").disabled = !c || S.laedt.has(c.id);
  zeichneNetz();
}
let offlineBereit = false;
function zeichneNetz() {
  $("#netz").innerHTML = !navigator.onLine ? `${ICON.offline}<span>offline</span>`
    : !offlineBereit && "serviceWorker" in navigator ? `<span>App wird fürs Offline-Spielen gespeichert …</span>` : "";
}
if ("serviceWorker" in navigator) navigator.serviceWorker.ready.then(() => { offlineBereit = true; zeichneNetz(); });
addEventListener("online", zeichneNetz); addEventListener("offline", zeichneNetz);

$("#cubes").addEventListener("click", ev => {
  const m = ev.target.closest("[data-menue]");
  if (m) return cubeMenue(S.cubes.find(c => c.id === m.dataset.menue));
  const b = ev.target.closest("[data-cube]"); if (!b) return;
  S.wahl = b.dataset.cube; zeichneStart();
});
let loeschenId = null;
$("#laufend").addEventListener("click", async ev => {
  const w = ev.target.closest("[data-weg]");
  if (w) {
    ev.stopPropagation();
    if (loeschenId !== w.dataset.weg) { loeschenId = w.dataset.weg; hinweis("Nochmal tippen zum Löschen"); setTimeout(() => { loeschenId = null; }, 3000); return; }
    await loesche("drafts", w.dataset.weg); loeschenId = null; await ladeAlles(); zeichneStart(); return;
  }
  const d = ev.target.closest("[data-draft]");
  if (d) oeffneDraft(d.dataset.draft);
});

function cubeMenue(c) {
  if (!c) return;
  const b = c.bilder || {};
  const box = blatt(`<h2>${esc(c.name)}</h2>
    <p class="klein-text">${c.format === "commander" ? "Commander" : "Vintage"} · ${c.karten.length} Karten · Bilder ${b.da || 0} von ${b.gesamt || "?"}${c.quelle ? ` · ${esc(c.quelle)}` : ""}</p>
    <button type="button" class="quelle" id="m_bilder">${ICON.laden}<span><b>Bilder laden</b><small>im WLAN, danach offline</small></span></button>
    <button type="button" class="quelle" id="m_weg">${ICON.weg}<span><b>Vom iPhone löschen</b><small>deine Drafts bleiben</small></span></button>`);
  box.querySelector("#m_bilder").onclick = () => { blattZu(); bilderLaden(c); };
  let sicher = false;
  box.querySelector("#m_weg").onclick = async ev => {
    if (!sicher) { sicher = true; ev.currentTarget.querySelector("b").textContent = "Wirklich löschen?"; return; }
    await loesche("cubes", c.id); blattZu(); await ladeAlles(); zeichneStart();
  };
}

// ================================================================ Cube laden: mitgeliefert, aus Dateien oder als Liste
$("#cube_laden").onclick = async () => {
  const box = blatt(`<h2>Cube laden</h2>
    <button type="button" class="quelle" id="q_datei">${ICON.datei}<span><b>Aus Dateien</b><small>vom PC (Ordner „handy“) oder eine Kartenliste</small></span></button>
    <p class="abschnitt">Mitgeliefert</p><div id="q_liste"><div class="lade"><i></i></div></div>`);
  box.querySelector("#q_datei").onclick = () => $("#datei").click();
  let liste = [];
  try { liste = await (await fetch("cubes/index.json", {cache: "no-cache"})).json(); } catch (e) {}
  const ziel = box.querySelector("#q_liste");
  if (!ziel) return;
  ziel.innerHTML = liste.length ? liste.map((x, i) => `<button type="button" class="quelle" data-mit="${i}" ${S.cubes.some(c => c.id === x.id) ? "disabled" : ""}>
      ${x.format === "commander" ? ICON.commander : ICON.vintage}<span><b>${esc(x.name)}</b><small>${x.format === "commander" ? "Commander" : "Vintage"} · ${x.karten} Karten${x.info ? " · " + esc(x.info) : ""}${S.cubes.some(c => c.id === x.id) ? " · schon da" : ""}</small></span></button>`).join("")
    : `<p class="klein-text">${navigator.onLine ? "Keine mitgelieferten Cubes." : "Offline – mitgelieferte Cubes gibt es im WLAN."}</p>`;
  ziel.querySelectorAll("[data-mit]").forEach(b => b.onclick = async () => {
    const x = liste[+b.dataset.mit];
    blattZu();
    try { aufnehmen(await (await fetch("cubes/" + x.datei)).json()); }
    catch (e) { hinweis("Laden fehlgeschlagen: " + e.message, 5000); }
  });
};
$("#datei").onchange = async ev => {
  const f = ev.target.files[0]; ev.target.value = "";
  if (!f) return;
  blattZu();
  const text = await f.text();
  if (/\.json$/i.test(f.name)) {
    let p;
    try { p = JSON.parse(text); } catch (e) { return hinweis("Die Datei ist kein gültiges JSON.", 5000); }
    if (p.art !== "cubegen-cube") return hinweis("Das ist keine Cube-Datei vom Generator.", 5000);
    return aufnehmen(p);
  }
  listeAufnehmen(f.name.replace(/\.(txt|csv)$/i, ""), text);
};
// Kartenliste: eine Karte pro Zeile („1 Name“ oder „Name“) oder eine CubeCobra-CSV
function namenAus(text) {
  const zeilen = text.replace(/\r/g, "").split("\n").map(z => z.trim()).filter(z => z && !z.startsWith("#") && !/^\/\//.test(z));
  if (zeilen.length && /^"?name"?,/i.test(zeilen[0])) {
    return zeilen.slice(1).map(z => { const m = z.match(/^"((?:[^"]|"")*)"|^([^,]*)/); return (m[1] ?? m[2] ?? "").replace(/""/g, '"'); }).filter(Boolean);
  }
  const out = [];
  for (const z of zeilen) {
    const m = z.match(/^(\d+)x?\s+(.+)$/i);
    const n = m ? Math.min(4, +m[1]) : 1, name = (m ? m[2] : z).replace(/\s+\([A-Z0-9]+\)\s*\d*\s*$/, "").trim();
    for (let i = 0; i < n; i++) out.push(name);
  }
  return out;
}
function listeAufnehmen(name, text) {
  const namen = namenAus(text);
  if (!namen.length) return hinweis("In der Datei steht keine Karte.", 4000);
  let fmt = namen.length >= 600 || /commander|edh/i.test(name) ? "commander" : "vintage";
  const box = blatt(`<h2>Kartenliste</h2><p class="klein-text">${namen.length} Karten. Die Kartendaten holt die App von Scryfall.</p>
    <div class="feld"><label for="l_name">Name</label><input id="l_name" value="${esc(name)}"></div>
    <div class="feld"><label>Format</label><div class="segmente" id="l_fmt"><button type="button" data-f="commander">Commander</button><button type="button" data-f="vintage">Vintage</button></div></div>
    <button type="button" class="gross" id="l_los">Laden</button>`);
  const fmtZeigen = () => box.querySelectorAll("[data-f]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.f === fmt)));
  fmtZeigen();
  box.querySelectorAll("[data-f]").forEach(b => b.onclick = () => { fmt = b.dataset.f; fmtZeigen(); });
  box.querySelector("#l_los").onclick = () => {
    const n = box.querySelector("#l_name").value.trim() || name;
    blattZu();
    aufnehmen({art: "cubegen-cube", v: 1, id: n.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + fmt, name: n, format: fmt, namen,
      spieler: 8, runden: 3, groesse: fmt === "commander" ? 20 : 15, mono: true, themen: [], staemme: [], archetypen: {}, quelle: "Liste"});
  };
}

async function aufnehmen(p) {
  const id = p.id || (p.name || "cube").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (S.laedt.has(id)) return;
  const status = (text, wert = 0, gesamt = 1) => { S.laedt.set(id, {text, wert, gesamt}); if (S.ansicht === "start") zeichneStart(); };
  const platzhalter = {id, name: p.name, format: p.format, karten: p.karten || [], zeit_geladen: Date.now()};
  if (!S.cubes.some(c => c.id === id)) S.cubes.unshift(platzhalter);
  S.wahl = id;
  try {
    let karten = p.karten || [];
    if (p.namen && p.namen.length) {
      status("Kartendaten von Scryfall …", 0, p.namen.length);
      karten = await ausScryfall(p, (w, g) => status("Kartendaten von Scryfall …", w, g));
    }
    if (!karten.length) throw new Error("Der Cube enthält keine Karten.");
    const c = {id, name: p.name, format: p.format, karten, syn: p.syn || {}, themen: p.themen || [], staemme: p.staemme || [],
      archetypen: p.archetypen || {}, mono: p.mono !== false, spieler: p.spieler || 8, runden: p.runden || 3,
      groesse: p.groesse || (p.format === "commander" ? 20 : 15), quelle: p.quelle || "", zeit: p.zeit || Date.now() / 1000,
      zeit_geladen: Date.now(), bilder: {da: 0, gesamt: 0}};
    await lege("cubes", c);
    S.laedt.delete(id);
    await ladeAlles();
    zeichneStart();
    await bilderLaden(c);
  } catch (e) {
    S.laedt.delete(id);
    await ladeAlles();
    zeichneStart();
    hinweis(`„${p.name}“: ${e.message}`, 6000);
  }
}

// Karten nur als Namen: Daten (Text, Bild, EDHREC-Rang) von Scryfall, die Werte rechnet draft.py
async function ausScryfall(p, fortschritt) {
  const bekannt = Object.fromEntries((p.karten || []).map(k => [k.name, k]));
  const eindeutig = [...new Set(p.namen.map(vorne))];
  const gefunden = new Map();
  for (let i = 0; i < eindeutig.length; i += 75) {
    const teil = eindeutig.slice(i, i + 75);
    const r = await fetch(SCRYFALL + "/cards/collection", {method: "POST", headers: {"Content-Type": "application/json", "Accept": "application/json"},
      body: JSON.stringify({identifiers: teil.map(name => ({name}))})});
    if (!r.ok) throw new Error(`Scryfall antwortet nicht (${r.status}). Bist du online?`);
    const j = await r.json();
    for (const c of j.data || []) { gefunden.set(norm(c.name), c); gefunden.set(norm(vorne(c.name)), c); }
    fortschritt(Math.min(eindeutig.length, i + 75), eindeutig.length);
    await pause(120);
  }
  const sf = [], fehlen = [];
  for (const n of p.namen) { const c = gefunden.get(norm(n)) || gefunden.get(norm(vorne(n))); c ? sf.push(c) : fehlen.push(n); }
  if (fehlen.length) hinweis(`${fehlen.length} Karten kennt Scryfall nicht: ${fehlen.slice(0, 4).join(", ")}${fehlen.length > 4 ? " …" : ""}`, 6000);
  return rufe("aus_scryfall", {karten: sf, format: p.format, bekannt});
}

// Bilder einmal laden (im WLAN), danach liegen sie im Speicher der App und gehen offline
async function bilderLaden(c) {
  if (S.laedt.has(c.id)) return;
  const urls = [...new Set(c.karten.flatMap(k => [k.bild, k.bild_rueck]).filter(Boolean))];
  let cache;
  try { cache = await caches.open(BILDER); } catch (e) { return hinweis("Bilder können hier nicht gespeichert werden.", 4000); }
  const fehlen = [];
  let da = 0;
  for (const u of urls) (await cache.match(u)) ? da++ : fehlen.push(u);
  const melden = () => { S.laedt.set(c.id, {text: `Bilder ${da} von ${urls.length} …`, wert: da, gesamt: urls.length}); if (S.ansicht === "start") zeichneStart(); };
  if (fehlen.length) {
    if (!navigator.onLine) { hinweis("Für die Bilder brauchst du Internet (am besten WLAN).", 4000); }
    else {
      melden();
      let fehler = 0;
      const hol = async u => {
        try {
          let r = await fetch(u, {mode: "cors"});
          if (!r.ok) throw new Error(r.status);
          await cache.put(u, r);
        } catch (e) {
          try { await cache.put(u, await fetch(u, {mode: "no-cors"})); } catch (e2) { fehler++; da--; }
        }
        da++;
        if (da % 8 === 0 || da === urls.length) melden();
      };
      const cdn = fehlen.filter(u => !u.startsWith(SCRYFALL)), api = fehlen.filter(u => u.startsWith(SCRYFALL));
      let i = 0;
      await Promise.all(Array.from({length: 6}, async () => { while (i < cdn.length) await hol(cdn[i++]); }));
      for (const u of api) { await hol(u); await pause(110); }       // Scryfall-API: höchstens 10 pro Sekunde
      if (fehler) hinweis(`${fehler} Bilder kamen nicht an – später nochmal „Bilder laden“.`, 5000);
    }
  }
  c.bilder = {da, gesamt: urls.length};
  await lege("cubes", c);
  S.laedt.delete(c.id);
  await ladeAlles();
  if (S.ansicht === "start") zeichneStart();
  if (fehlen.length && da >= urls.length) hinweis(`„${c.name}“ ist offline bereit.`);
}

// ================================================================ Draft starten: der Tisch
const T = {spieler: 8, runden: 3, groesse: 15, picks: 1, bots: "normal"};
$("#los").onclick = () => {
  const c = S.cubes.find(x => x.id === S.wahl); if (!c) return;
  Object.assign(T, {spieler: Math.min(12, c.spieler || 8), runden: c.runden || 3, groesse: c.groesse || 15,
    picks: c.format === "commander" && (c.groesse || 15) >= 18 ? 2 : 1, bots: T.bots});
  zeichneTisch(c);
};
const BOTS = [["leicht", "Leicht"], ["normal", "Normal"], ["stark", "Stark"], ["gemischt", "Gemischt"]];
function zeichneTisch(c) {
  const benoetigt = T.spieler * T.runden * T.groesse;
  const box = blatt(`<h2>${esc(c.name)}</h2>
    ${[["spieler", "Spieler", v => `${v} (du + ${v - 1})`], ["runden", "Booster", v => `${v} je Spieler`], ["groesse", "Karten", v => `${v} je Booster`], ["picks", "Picks", v => v === 2 ? "2 auf einmal" : "1"]].map(([f, l, t]) =>
      `<div class="zeile"><span>${l}</span><span class="stepper"><button type="button" data-f="${f}" data-r="-1" aria-label="weniger">−</button><output>${t(T[f])}</output><button type="button" data-f="${f}" data-r="1" aria-label="mehr">+</button></span></div>`).join("")}
    <div class="feld"><label>Bots</label><div class="segmente">${BOTS.map(([v, t]) => `<button type="button" data-bots="${v}" aria-pressed="${T.bots === v}">${t}</button>`).join("")}</div></div>
    ${benoetigt > c.karten.length ? `<p class="klein-text">Der Cube hat ${c.karten.length} Karten – die Booster werden etwas kleiner.</p>` : ""}
    <button type="button" class="gross" id="t_los">${motorBereit ? "Los" : "Los (Motor startet …)"}</button>`);
  const grenzen = {spieler: [2, 12], runden: [1, 5], groesse: [8, 20], picks: [1, 2]};
  box.querySelectorAll("[data-f]").forEach(b => b.onclick = () => {
    const [lo, hi] = grenzen[b.dataset.f];
    T[b.dataset.f] = Math.max(lo, Math.min(hi, T[b.dataset.f] + +b.dataset.r));
    zeichneTisch(c);
  });
  box.querySelectorAll("[data-bots]").forEach(b => b.onclick = () => { T.bots = b.dataset.bots; zeichneTisch(c); });
  box.querySelector("#t_los").onclick = async ev => {
    const b = ev.currentTarget; b.disabled = true; b.textContent = "Booster werden gepackt …";
    try {
      const r = await rufe("neu", {paket: c, tisch: {...T, seed: 1 + Math.floor(Math.random() * 1e9)}});
      blattZu();
      S.draftId = r.a.id; S.z = r.z; S.a = r.a; S.auswahl = [];
      await sichern(c.id);
      zeichneDraft(true);
    } catch (e) { b.disabled = false; b.textContent = "Los"; hinweis(e.message, 6000); }
  };
}

// Jeder Stand wird sofort gespeichert – ein Draft geht nie verloren
async function sichern(cubeId) {
  const a = S.a, alt = S.drafts.find(d => d.id === a.id) || {};
  const stand = a.fertig ? (a.mein_deck ? "fertig · Deck gebaut" : "fertig · Deck bauen") : `Paket ${a.runde + 1} · Pick ${a.pick_nr}`;
  const rec = {id: a.id, name: a.name, format: a.format, cube: cubeId || alt.cube, zeit: alt.zeit || Date.now(), aktualisiert: Date.now(),
    exportiert: alt.exportiert || 0, fertig: a.fertig, stand, z: S.z};
  await lege("drafts", rec);
  const i = S.drafts.findIndex(d => d.id === rec.id);
  if (i >= 0) S.drafts[i] = rec; else S.drafts.unshift(rec);
}
async function oeffneDraft(id) {
  const d = S.drafts.find(x => x.id === id); if (!d) return;
  try {
    const r = await rufe("ansicht", {z: d.z});
    S.draftId = id; S.z = r.z; S.a = r.a; S.auswahl = []; S.D = null;
    r.a.fertig ? zeigeDeck() : zeichneDraft(false);
  } catch (e) { hinweis(e.message, 5000); }
}

// ================================================================ Draft
function zeichneDraft(neu) {
  const a = S.a;
  zeige("draft");
  $("#d_pakete").innerHTML = Array.from({length: a.runden}, (_, i) => `<span class="${i < a.runde ? "durch" : i === a.runde ? "an" : ""}"></span>`).join("");
  $("#d_pick").textContent = `Pick ${a.picks > 1 ? `${a.pick_nr}–${a.pick_nr + a.picks - 1}` : a.pick_nr}`;
  $("#d_richtung").textContent = a.richtung === "links" ? "→" : "←";
  $("#d_richtung").title = "Weitergabe nach " + a.richtung;
  $("#d_pool_zahl").textContent = a.pool.length;
  $("#d_paket").innerHTML = a.paket.map(k => karteHtml(k, S.auswahl.includes(k.id) ? "an" : "")).join("");
  if (neu) $("#d_paket").scrollTop = 0;
  zeichneWahl();
}
function zeichneWahl() {
  const a = S.a;
  $$("#d_paket .karte").forEach(el => {
    const i = S.auswahl.indexOf(el.dataset.id);
    el.classList.toggle("an", i >= 0);
    let nr = el.querySelector(".nr");
    if (a.picks > 1 && i >= 0) { if (!nr) { nr = document.createElement("span"); nr.className = "nr"; el.appendChild(nr); } nr.textContent = i + 1; }
    else if (nr) nr.remove();
  });
  const b = $("#d_nehmen"), fehlt = a.picks - S.auswahl.length;
  b.disabled = fehlt > 0;
  const k = a.paket.find(x => x.id === S.auswahl[0]);
  b.textContent = fehlt > 0 ? (a.picks > 1 ? `${fehlt === a.picks ? a.picks + " Karten" : "Noch eine"} wählen` : "Karte wählen")
    : a.picks > 1 ? "Beide nehmen" : `${vorne(k ? k.name : "")} nehmen`;
}
$("#d_paket").addEventListener("click", ev => {
  if (gezoomt) { gezoomt = false; return; }
  const el = ev.target.closest(".karte"); if (!el || sperre) return;
  const id = el.dataset.id, a = S.a;
  if (a.picks === 1) {
    if (S.auswahl[0] === id) return nimm();
    S.auswahl = [id];
  } else {
    const i = S.auswahl.indexOf(id);
    if (i >= 0) S.auswahl.splice(i, 1); else { S.auswahl.push(id); while (S.auswahl.length > a.picks) S.auswahl.shift(); }
  }
  zeichneWahl();
});
lupe($("#d_paket"), id => S.a.paket.find(k => k.id === id));
$("#d_nehmen").onclick = () => nimm();
$("#d_auto").onclick = () => nimm(true);
let sperre = false;
async function nimm(auto = false) {
  if (sperre || !S.a || S.a.fertig) return;
  if (!auto && S.auswahl.length !== S.a.picks) return;
  sperre = true;
  const ids = auto ? [] : [...S.auswahl];
  ids.forEach(id => { const el = $(`#d_paket .karte[data-id="${CSS.escape(id)}"]`); if (el) el.classList.add("weg"); });
  try {
    const [r] = await Promise.all([rufe("pick", auto ? {z: S.z, auto: true} : {z: S.z, karten: ids}), pause(ids.length ? 220 : 0)]);
    S.z = r.z; S.a = r.a; S.auswahl = [];
    await sichern();
    if (S.a.fertig) { S.D = null; zeigeDeck(); hinweis("Draft fertig – jetzt dein Deck."); }
    else zeichneDraft(true);
  } catch (e) { hinweis(e.message, 5000); zeichneDraft(false); }
  sperre = false;
}
$("#d_pool").onclick = () => {
  const p = S.a.pool, farben = {};
  p.forEach(k => { if (!k.land) [...(k.farben || "")].forEach(c => farben[c] = (farben[c] || 0) + 1); });
  const box = blatt(`<h2>Deine Picks</h2>
    <div class="pool-kopf"><span>${p.length} Karten</span><span>${p.filter(k => k.kreatur).length} Kreaturen</span>
      ${Object.entries(farben).sort((x, y) => y[1] - x[1]).map(([c, n]) => `<span>${pipsHtml(c)} ${n}</span>`).join("")}</div>
    <div class="raster" id="p_raster">${sortiert(p).map(k => karteHtml(k)).join("") || `<p class="klein-text">Noch leer.</p>`}</div>`);
  const r = box.querySelector("#p_raster");
  lupe(r, id => p.find(k => k.id === id));
  r.addEventListener("click", ev => { if (gezoomt) { gezoomt = false; return; } const el = ev.target.closest(".karte"); if (el) zoom(p.find(k => k.id === el.dataset.id)); });
};
const FARBREIHE = k => k.land ? 9 : !k.farben ? 7 : k.farben.length > 1 ? 6 : "WUBRG".indexOf(k.farben);
const sortiert = l => [...l].sort((a, b) => FARBREIHE(a) - FARBREIHE(b) || a.cmc - b.cmc || a.name.localeCompare(b.name));

// ================================================================ Deck bauen
function zeigeDeck() {
  const a = S.a;
  if (!S.D) {
    const d = a.mein_deck || a.vorschlag || {main: [], basics: {}};
    S.D = {main: [...(d.main || [])], commander: d.commander || null, partner: d.partner || null, basics: {...(d.basics || {})},
      groesse: d.groesse || (a.format === "commander" ? 60 : 40), name: d.name || a.name + " – Draft"};
  }
  zeige("deck");
  zeichneDeck();
}
const kannZweiten = k => (k.gespann || []).some(x => ["partner", "cab", "begleiter", "doctor", "mono"].includes(x) || x.startsWith("mit:") || x.startsWith("gruppe:"));
function passenZusammen(x, y) {
  if (!x || !y || x.id === y.id) return false;
  const A = new Set(x.gespann || []), B = new Set(y.gespann || []);
  if ((A.has("cab") && B.has("background")) || (B.has("cab") && A.has("background"))) return true;
  if (A.has("background") || B.has("background")) return false;
  const mono = S.a.mono_partner !== false;
  if ((A.has("partner") || (mono && A.has("mono"))) && (B.has("partner") || (mono && B.has("mono")))) return true;
  if ([...A].some(t => t.startsWith("gruppe:") && B.has(t))) return true;
  if (A.has("mit:" + norm(vorne(y.name))) || B.has("mit:" + norm(vorne(x.name)))) return true;
  return (A.has("begleiter") && B.has("doctor")) || (B.has("begleiter") && A.has("doctor"));
}
function zeichneDeck() {
  const a = S.a, D = S.D, byId = Object.fromEntries(a.pool.map(k => [k.id, k]));
  const cmdFormat = a.format === "commander";
  const cmds = [D.commander, D.partner].filter(Boolean).map(i => byId[i]).filter(Boolean);
  const imDeck = D.main.map(i => byId[i]).filter(Boolean);
  const rest = a.pool.filter(k => !D.main.includes(k.id) && k.id !== D.commander && k.id !== D.partner);
  const basics = Object.values(D.basics).reduce((x, y) => x + y, 0);
  const anzahl = imDeck.length + basics + cmds.length;
  const kurve = ["0–1", "2", "3", "4", "5", "6+"].map((t, i) => [t, imDeck.filter(k => !k.land && (i === 0 ? k.cmc <= 1 : i === 5 ? k.cmc >= 6 : k.cmc === i + 1)).length]);
  const kmax = Math.max(1, ...kurve.map(x => x[1]));
  const krone = k => cmdFormat && (k.legendaer || k.background) ? `<span class="krone ${k.id === D.commander || k.id === D.partner ? "an" : ""}" data-krone="${esc(k.id)}" role="button" aria-label="als Commander">♛</span>` : "";
  $("#k_zahl").textContent = `${anzahl} / ${D.groesse}`;
  $("#k_inhalt").innerHTML = `
    ${cmdFormat ? `<div><p class="abschnitt">Commander</p>${cmds.length ? `<div class="raster" id="k_cmd">${cmds.map(k => karteHtml(k, "", krone(k))).join("")}</div>`
      : `<p class="klein-text">Tippe im Pool auf ♛ bei einer legendären Kreatur.</p>`}</div>` : ""}
    <div><p class="abschnitt">Im Deck · ${imDeck.length + cmds.length} + ${basics} Länder</p><div class="raster" id="k_deck">${sortiert(imDeck).map(k => karteHtml(k)).join("")}</div></div>
    <div><p class="abschnitt">Manakurve</p><div class="kurve">${kurve.map(([t, n]) => `<div><span>${n}</span><i style="height:${Math.round(n / kmax * 40)}px"></i><b>${t}</b></div>`).join("")}</div></div>
    <div><p class="abschnitt">Standardländer</p><div class="basics">${"WUBRG".split("").map(c => `<div class="basic"><i style="background:${FARBEN[c]}"></i><b>${D.basics[c] || 0}</b>
      <div><button type="button" data-land="${c}" data-r="-1" aria-label="${BASIS[c]} weniger">−</button><button type="button" data-land="${c}" data-r="1" aria-label="${BASIS[c]} mehr">+</button></div></div>`).join("")}</div>
      <button type="button" class="neu-cube" id="k_auto" style="margin-top:10px">Länder automatisch</button></div>
    <div><p class="abschnitt">Pool · tippen nimmt ins Deck</p><div class="raster" id="k_pool">${sortiert(rest).map(k => karteHtml(k, "", krone(k))).join("")}</div></div>
    <div class="segmente">${[40, 60, 100].map(g => `<button type="button" data-groesse="${g}" aria-pressed="${D.groesse === g}">${g} Karten</button>`).join("")}</div>`;
}
lupe($("#k_inhalt"), id => S.a && S.a.pool.find(k => k.id === id));
$("#k_inhalt").addEventListener("click", ev => {
  if (gezoomt) { gezoomt = false; return; }
  const D = S.D, a = S.a, byId = Object.fromEntries(a.pool.map(k => [k.id, k]));
  const kr = ev.target.closest("[data-krone]");
  if (kr) {
    const k = byId[kr.dataset.krone], cmd = byId[D.commander];
    if (k.id === D.commander) { D.commander = D.partner; D.partner = null; }
    else if (k.id === D.partner) D.partner = null;
    else if (!cmd) D.commander = k.id;
    else if (!D.partner && passenZusammen(cmd, k)) D.partner = k.id;
    else { D.commander = k.id; if (D.partner && !passenZusammen(k, byId[D.partner])) D.partner = null; }
    if (k.background && D.commander === k.id && !D.partner) { D.commander = cmd ? cmd.id : null; hinweis("Ein Background braucht einen Commander mit „Choose a Background“."); }
    D.main = D.main.filter(i => i !== D.commander && i !== D.partner);
    return zeichneDeck();
  }
  const l = ev.target.closest("[data-land]");
  if (l) { D.basics[l.dataset.land] = Math.max(0, (D.basics[l.dataset.land] || 0) + +l.dataset.r); return zeichneDeck(); }
  const g = ev.target.closest("[data-groesse]");
  if (g) { D.groesse = +g.dataset.groesse; return zeichneDeck(); }
  if (ev.target.closest("#k_auto")) { autoLaender(); return zeichneDeck(); }
  const el = ev.target.closest(".karte"); if (!el) return;
  const id = el.dataset.id;
  if (el.closest("#k_deck")) D.main = D.main.filter(i => i !== id);
  else if (el.closest("#k_pool")) D.main.push(id);
  else if (el.closest("#k_cmd")) zoom(byId[id]);
  zeichneDeck();
});
function autoLaender() {
  const D = S.D, byId = Object.fromEntries(S.a.pool.map(k => [k.id, k]));
  const karten = D.main.concat([D.commander, D.partner].filter(Boolean)).map(i => byId[i]).filter(Boolean);
  const ziel = D.groesse >= 100 ? 37 : D.groesse >= 60 ? 24 : 17;
  const rest = Math.max(0, Math.min(ziel - karten.filter(k => k.land).length, D.groesse - karten.length));
  const sym = {}; karten.forEach(k => { for (const c of "WUBRG") sym[c] = (sym[c] || 0) + ((k.mana || "").split(c).length - 1); });
  const summe = Object.values(sym).reduce((x, y) => x + y, 0);
  D.basics = {};
  if (!summe) return;
  let verteilt = 0;
  const anteile = Object.entries(sym).filter(([, n]) => n).map(([c, n]) => [c, rest * n / summe]);
  anteile.forEach(([c, x]) => { D.basics[c] = Math.floor(x); verteilt += Math.floor(x); });
  anteile.sort((x, y) => (y[1] % 1) - (x[1] % 1)).slice(0, rest - verteilt).forEach(([c]) => D.basics[c]++);
}
$("#k_vorschlag").onclick = () => {
  const v = S.a.vorschlag; if (!v) return;
  S.D = {...S.D, main: [...v.main], commander: v.commander || null, partner: v.partner || null, basics: {...(v.basics || {})}};
  zeichneDeck();
};
$("#k_fertig").onclick = async ev => {
  const b = ev.currentTarget; b.disabled = true;
  try {
    const r = await rufe("deck", {z: S.z, deck: S.D});
    S.z = r.z; S.a = r.a;
    await sichern();
    hinweis("Deck gespeichert.");
    await ladeAlles(); zeichneStart();
  } catch (e) { hinweis(e.message, 5000); }
  b.disabled = false;
};
$("#k_bots").onclick = async () => {
  zeige("bots");
  $("#b_inhalt").innerHTML = `<div class="lade"><i></i></div>`;
  try {
    const r = await rufe("auswertung", {z: S.z});
    $("#b_inhalt").innerHTML = r.decks.map(d => `<div class="bot"><h3>${esc(d.name)} ${pipsHtml(d.farben)}</h3><p>${esc(d.stil || "")}${d.commander ? ` · ♛ ${esc(vorne(d.commander.name))}${d.partner ? " + " + esc(vorne(d.partner.name)) : ""}` : ""}</p>
      <ul>${d.main.filter(k => !k.land).sort((x, y) => x.cmc - y.cmc).map(k => `<li>${esc(vorne(k.name))}</li>`).join("")}</ul></div>`).join("");
  } catch (e) { $("#b_inhalt").innerHTML = `<p class="fehler-text">${esc(e.message)}</p>`; }
};

// ================================================================ Zurück
document.addEventListener("click", ev => {
  if (!ev.target.closest("[data-zurueck]")) return;
  if (S.ansicht === "bots") return zeigeDeck();
  ladeAlles().then(zeichneStart);
});

// ================================================================ Drafts an den PC: als Datei in den Ordner „handy“
$("#sync").onclick = async () => {
  const neu = S.drafts.filter(d => d.aktualisiert > (d.exportiert || 0));
  const liste = neu.length ? neu : S.drafts;
  if (!liste.length) return hinweis("Noch keine Drafts.");
  const jetzt = new Date();
  const zwei = n => String(n).padStart(2, "0");
  const stempel = `${jetzt.getFullYear()}-${zwei(jetzt.getMonth() + 1)}-${zwei(jetzt.getDate())} ${zwei(jetzt.getHours())}-${zwei(jetzt.getMinutes())}`;
  const inhalt = JSON.stringify({art: "cubegen-drafts", v: 1, zeit: jetzt.getTime() / 1000, drafts: liste.map(d => JSON.parse(d.z))});
  const datei = new File([inhalt], `Drafts ${stempel}.drafts.json`, {type: "application/json"});
  const box = blatt(`<h2>Drafts zum PC</h2>
    <p class="klein-text">${liste.length} Draft${liste.length === 1 ? "" : "s"}. Sichere die Datei in OneDrive unter <b>Desktop › Cube Gen › handy</b>.
      Beim nächsten Start liest der Generator sie ein, und deine Picks fließen in die Kartenbewertung.</p>
    <button type="button" class="gross" id="s_teilen">In Dateien sichern</button>`);
  box.querySelector("#s_teilen").onclick = async () => {
    let ok = false;
    try {
      if (navigator.canShare && navigator.canShare({files: [datei]})) { await navigator.share({files: [datei], title: datei.name}); ok = true; }
      else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(datei); a.download = datei.name; document.body.appendChild(a); a.click(); a.remove();
        ok = true;
      }
    } catch (e) { if (e.name !== "AbortError") hinweis(e.message, 5000); }
    if (!ok) return;
    const zeit = Date.now();
    for (const d of liste) { d.exportiert = zeit; await lege("drafts", d); }
    blattZu(); zeichneStart(); hinweis("Gesichert.");
  };
};

// ================================================================ Start der App
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
  let neuGeladen = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (neuGeladen || S.ansicht !== "start") return;
    neuGeladen = true; location.reload();
  });
}
await ladeAlles();
zeichneStart();
// Cubes, deren Bilder noch fehlen, im WLAN still weiterladen
for (const c of S.cubes) if (navigator.onLine && c.bilder && c.bilder.da < c.bilder.gesamt) bilderLaden(c);
