// MankevCars reminder service (Cloudflare Worker). Only the line marked EDIT needs changing.
const ALLOWED_ORIGIN = "https://YOUR-USERNAME.github.io"; // EDIT: your GitHub Pages address, no slash at the end

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const HOSTS = /(^|\.)(googleapis\.com|push\.apple\.com|mozilla\.com|mozaws\.net|notify\.windows\.com)$/;
const STEPS = [30, 14, 7, 3, 1, 0];
const TXT = {
  lt: { i: "techninė apžiūra", s: "draudimas", title: "MankevCars priminimas", ok: "Priminimai veikia.", d: (n) => (n < 0 ? `pavėluota ${-n} d.` : n === 0 ? "šiandien" : `po ${n} d.`) },
  en: { i: "technical inspection", s: "insurance", title: "MankevCars reminder", ok: "Reminders are working.", d: (n) => (n < 0 ? `overdue by ${-n} days` : n === 0 ? "is due today" : `is due in ${n} days`) },
};
const cors = { "Access-Control-Allow-Origin": ALLOWED_ORIGIN, "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Vilnius" });
const daysLeft = (d) => Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(today() + "T00:00:00Z")) / 864e5);
const dateOk = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || "") ? d : "");
const okEndpoint = (e) => { try { const u = new URL(e); return u.protocol === "https:" && HOSTS.test(u.hostname) && e.length < 1000; } catch { return false; } };
async function devKey(endpoint) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(endpoint)));
  return "d:" + [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function due(dev) {
  const out = [];
  for (const c of dev.cars || []) for (const [k, d] of [["i", c.i], ["s", c.s]]) {
    if (!d) continue;
    const n = daysLeft(d);
    if (STEPS.includes(n) || (n < 0 && (-n) % 7 === 0)) out.push({ car: c.n, k, n });
  }
  return out;
}
function message(dev) {
  const L = TXT[dev && dev.lang] || TXT.lt, list = dev ? due(dev) : [];
  if (!list.length) return { title: "MankevCars", body: L.ok };
  return { title: L.title, body: list.map((x) => `${x.car}: ${L[x.k]} ${L.d(x.n)}`).join("\n") };
}

let cachedKeys;
async function getKeys(env) {
  if (cachedKeys) return cachedKeys;
  let raw = await env.KV.get("vapid");
  if (!raw) {
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const priv = await crypto.subtle.exportKey("jwk", kp.privateKey);
    const pub = b64u(await crypto.subtle.exportKey("raw", kp.publicKey));
    raw = JSON.stringify({ priv, pub });
    await env.KV.put("vapid", raw);
  }
  return (cachedKeys = JSON.parse(raw));
}
async function vapid(env, endpoint) {
  const k = await getKeys(env);
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: ALLOWED_ORIGIN })));
  const key = await crypto.subtle.importKey("jwk", k.priv, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(head + "." + body));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${k.pub}`;
}
async function push(env, endpoint) {
  const r = await fetch(endpoint, { method: "POST", headers: { Authorization: await vapid(env, endpoint), TTL: "43200", Urgency: "high" } });
  return r.status;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), json = (x) => new Response(JSON.stringify(x), { headers: { ...cors, "Content-Type": "application/json" } });
    const text = (t, s = 200) => new Response(t, { status: s, headers: cors });
    if (req.method === "OPTIONS") return text("", 204);
    if (req.method === "GET" && url.pathname === "/key") return text((await getKeys(env)).pub);
    if (req.method !== "POST" || req.headers.get("Origin") !== ALLOWED_ORIGIN) return text("Not allowed", 403);
    let b; try { const raw = await req.text(); if (raw.length > 20000) throw 0; b = JSON.parse(raw); } catch { return text("Bad request", 400); }
    if (!okEndpoint(b.endpoint)) return text("Bad endpoint", 400);
    const key = await devKey(b.endpoint);
    if (url.pathname === "/sync") {
      const cars = (Array.isArray(b.cars) ? b.cars : []).slice(0, 10).map((c) => ({ n: String(c.n || "").slice(0, 40), i: dateOk(c.i), s: dateOk(c.s) }));
      await env.KV.put(key, JSON.stringify({ endpoint: b.endpoint, lang: b.lang === "en" ? "en" : "lt", cars }));
      return text("ok");
    }
    if (url.pathname === "/pending") { const raw = await env.KV.get(key); return json(message(raw ? JSON.parse(raw) : null)); }
    if (url.pathname === "/test") return text("status " + (await push(env, b.endpoint)));
    if (url.pathname === "/remove") { await env.KV.delete(key); return text("ok"); }
    return text("Not found", 404);
  },

  async scheduled(event, env) {
    const list = await env.KV.list({ prefix: "d:" });
    for (const { name } of list.keys) {
      const raw = await env.KV.get(name);
      if (!raw) continue;
      const dev = JSON.parse(raw);
      if (!due(dev).length) continue;
      const st = await push(env, dev.endpoint);
      if (st === 404 || st === 410) await env.KV.delete(name);
    }
  },
};
