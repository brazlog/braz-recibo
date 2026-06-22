// Cloudflare Pages Function — recebe o comprovante e grava no NocoDB.
// O token do NocoDB fica em variável de ambiente (server-side), nunca no cliente.
// Env: NOCODB_URL, NOCODB_TOKEN, NOCODB_TABLE

export async function onRequestPost(context) {
  const { request, env } = context;

  // --- anti-abuso 1: só aceita requisição vinda do próprio app ---
  const allow = /^https:\/\/([a-z0-9-]+\.)?braz-recibo\.pages\.dev/;
  const origin = request.headers.get("Origin") || "";
  const ref = request.headers.get("Referer") || "";
  if (!(allow.test(origin) || allow.test(ref))) return json({ ok: false, error: "origem nao permitida" }, 403);

  // --- anti-abuso 2: limite por IP (~10 envios / 10 min, via cache de borda) ---
  try {
    const ip = request.headers.get("CF-Connecting-IP") || "0";
    const cache = caches.default;
    const key = new Request("https://rl.internal/recibo/" + ip);
    const hit = await cache.match(key);
    const count = hit ? (parseInt(await hit.text()) || 0) : 0;
    if (count >= 10) return json({ ok: false, error: "muitas tentativas, aguarde alguns minutos" }, 429);
    await cache.put(key, new Response(String(count + 1), { headers: { "Cache-Control": "max-age=600" } }));
  } catch (e) { /* se o cache falhar, segue normal */ }

  const NB = env.NOCODB_URL, TK = env.NOCODB_TOKEN, TBL = env.NOCODB_TABLE;
  if (!NB || !TK || !TBL) return json({ ok: false, error: "config ausente" }, 500);

  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: "json invalido" }, 400); }
  const { nome, telefone, recibo_id, pacotes } = body || {};
  if (!Array.isArray(pacotes) || pacotes.length === 0) return json({ ok: false, error: "sem pacotes" }, 400);
  if (pacotes.length > 20) return json({ ok: false, error: "limite de pacotes" }, 400); // anti-abuso

  const saved = [];
  for (const p of pacotes) {
    if (!p || !p.djp || !/^DJP/i.test(p.djp)) continue; // só aceita código DJP válido
    let foto = [];
    if (p.foto && typeof p.foto === "string" && p.foto.startsWith("data:")) {
      try {
        const bytes = dataUrlToBytes(p.foto);
        if (bytes.length <= 5_000_000) { // limite ~5MB por foto
          const fd = new FormData();
          fd.append("file", new Blob([bytes], { type: "image/jpeg" }), `${p.djp}.jpg`);
          const up = await fetch(`${NB}/api/v2/storage/upload`, { method: "POST", headers: { "xc-token": TK }, body: fd });
          if (up.ok) foto = await up.json();
        }
      } catch (e) { /* se a foto falhar, grava o registro mesmo assim */ }
    }
    const rec = { djp: p.djp, nome: nome || "", telefone: telefone || "", recibo_id: recibo_id || "", origem: "balcao", foto };
    try {
      const cr = await fetch(`${NB}/api/v2/tables/${TBL}/records`, {
        method: "POST",
        headers: { "xc-token": TK, "Content-Type": "application/json" },
        body: JSON.stringify(rec)
      });
      if (cr.ok) { const r = await cr.json(); saved.push({ djp: p.djp, id: r.Id || r.id }); }
    } catch (e) { /* segue pro próximo */ }
  }
  return json({ ok: saved.length > 0, saved: saved.length, total: pacotes.length });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
function dataUrlToBytes(dataUrl) {
  const b64 = dataUrl.split(",")[1] || "";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
