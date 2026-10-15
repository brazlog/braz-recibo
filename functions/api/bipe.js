// Pages Function — recebe bipes do app braz-bipe (celulares da loja) e grava no NocoDB.
// O token do NocoDB fica em variável de ambiente (server-side), nunca no celular.
// Env: NOCODB_URL, NOCODB_TOKEN, NOCODB_TABLE_BIPES, BIPE_KEY (chave compartilhada com o app)

export async function onRequestPost({ request, env }) {
  const NB = env.NOCODB_URL, TK = env.NOCODB_TOKEN, TBL = env.NOCODB_TABLE_BIPES, KEY = env.BIPE_KEY;
  if (!NB || !TK || !TBL || !KEY) return json({ ok: false, error: "config ausente" }, 500);
  if (request.headers.get("X-Bipe-Key") !== KEY) return json({ ok: false, error: "chave" }, 401);

  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: "json invalido" }, 400); }
  const bipes = Array.isArray(body && body.bipes) ? body.bipes.slice(0, 200) : [];
  if (!bipes.length) return json({ ok: false, error: "sem bipes" }, 400);

  const rows = [];
  for (const b of bipes) {
    if (!b || typeof b.codigo !== "string" || !/^[A-Z0-9-]{6,40}$/i.test(b.codigo)) continue;
    rows.push({
      codigo: b.codigo, tipo: s(b.tipo), evento: s(b.evento), hora: s(b.hora),
      aparelho: s(b.aparelho), tela: s(b.tela, 120), duplicado: !!b.duplicado, uid: s(b.uid)
    });
  }
  if (!rows.length) return json({ ok: false, error: "nenhum bipe valido" }, 400);

  let r;
  try {
    r = await fetch(`${NB}/api/v2/tables/${TBL}/records`, {
      method: "POST", headers: { "xc-token": TK, "Content-Type": "application/json" }, body: JSON.stringify(rows)
    });
  } catch (e) { return json({ ok: false, error: "rede" }, 502); }
  if (!r.ok) return json({ ok: false, error: "nocodb " + r.status }, 502);
  return json({ ok: true, saved: rows.length });
}

// Contagem do dia (uso da loja) — GET /api/bipe?dia=2026-10-15  (mesma chave no header)
export async function onRequestGet({ request, env }) {
  const NB = env.NOCODB_URL, TK = env.NOCODB_TOKEN, TBL = env.NOCODB_TABLE_BIPES, KEY = env.BIPE_KEY;
  if (!NB || !TK || !TBL || !KEY) return json({ ok: false, error: "config ausente" }, 500);
  if (request.headers.get("X-Bipe-Key") !== KEY) return json({ ok: false, error: "chave" }, 401);
  const dia = (new URL(request.url).searchParams.get("dia") || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return json({ ok: false, error: "dia invalido" }, 400);
  const q = `${NB}/api/v2/tables/${TBL}/records?where=(hora,like,${dia}%25)&limit=1000&fields=codigo,tipo,hora,aparelho`;
  let d;
  try { const r = await fetch(q, { headers: { "xc-token": TK } }); if (!r.ok) return json({ ok: false, error: "nocodb" }, 502); d = await r.json(); }
  catch (e) { return json({ ok: false, error: "rede" }, 502); }
  return json({ ok: true, dia, total: (d.list || []).length, bipes: d.list || [] });
}

function s(v, max = 64) { return typeof v === "string" ? v.slice(0, max) : ""; }
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
