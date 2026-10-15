// Pages Function — LOJA. Dois modos (protegidos por STAFF_PASS):
//   • detalhe: ?djp=XXXX&pass=...   → 1 registro + FOTO (base64) pra mostrar no balcão.
//   • lista:   ?list=1&pass=...&page=N&q=...  → banco completo paginado, SEM foto (rápido).
// Env: NOCODB_URL, NOCODB_TOKEN, NOCODB_TABLE, STAFF_PASS

export async function onRequestGet(context) {
  const { request, env } = context;
  const NB = env.NOCODB_URL, TK = env.NOCODB_TOKEN, TBL = env.NOCODB_TABLE, PASS = env.STAFF_PASS;
  const url = new URL(request.url);
  const pass = url.searchParams.get("pass") || "";

  if (!PASS || pass !== PASS) return json({ ok: false, error: "senha" }, 401);

  // ===== MODO LISTA: banco completo, paginado, sem foto =====
  if (url.searchParams.get("list") === "1") {
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1") || 1);
    const limit = 50;
    const offset = (page - 1) * limit;
    const q = (url.searchParams.get("q") || "").trim();
    let where = "";
    if (q) {
      const eq = encodeURIComponent(q);
      // operadores/parenteses crus + curinga %25 (= %) — mesmo estilo de encode do modo detalhe
      where = `&where=(nome,like,%25${eq}%25)~or(djp,like,%25${eq}%25)~or(telefone,like,%25${eq}%25)`;
    }
    const qUrl = `${NB}/api/v2/tables/${TBL}/records?limit=${limit}&offset=${offset}&sort=-CreatedAt${where}`;
    let d;
    try {
      const r = await fetch(qUrl, { headers: { "xc-token": TK } });
      if (!r.ok) return json({ ok: false, error: "nocodb" }, 502);
      d = await r.json();
    } catch (e) { return json({ ok: false, error: "rede" }, 502); }
    const rows = (d.list || []).map(rec => ({
      djp: rec.djp, nome: rec.nome, telefone: rec.telefone, recibo_id: rec.recibo_id,
      criado: rec.CreatedAt || rec.created_at || null,
      tem_foto: Array.isArray(rec.foto) && rec.foto.length > 0
    }));
    const pi = d.pageInfo || {};
    return json({
      ok: true, rows, page,
      total: (pi.totalRows ?? null),
      isLastPage: (pi.isLastPage ?? (rows.length < limit))
    });
  }

  // ===== MODO DETALHE: por DJP, com foto =====
  const djp = (url.searchParams.get("djp") || "").trim();
  if (!djp) return json({ ok: false, error: "djp vazio" }, 400);

  const q = `${NB}/api/v2/tables/${TBL}/records?where=(djp,eq,${encodeURIComponent(djp)})&limit=10&sort=-CreatedAt`;
  let d;
  try {
    const r = await fetch(q, { headers: { "xc-token": TK } });
    if (!r.ok) return json({ ok: false, error: "nocodb" }, 502);
    d = await r.json();
  } catch (e) { return json({ ok: false, error: "rede" }, 502); }

  const records = [];
  for (const rec of (d.list || [])) {
    let foto = null;
    const f = Array.isArray(rec.foto) ? rec.foto[0] : null;
    if (f && f.path) {
      try {
        const img = await fetch(`${NB}/${f.path}`);
        if (img.ok) {
          const buf = await img.arrayBuffer();
          foto = `data:${f.mimetype || "image/jpeg"};base64,${bufToB64(buf)}`;
        }
      } catch (e) { /* sem foto */ }
    }
    records.push({
      djp: rec.djp, nome: rec.nome, telefone: rec.telefone,
      recibo_id: rec.recibo_id, criado: rec.CreatedAt || rec.created_at || null, foto
    });
  }
  return json({ ok: true, total: records.length, records });
}

function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } }); }
function bufToB64(buf) { let bin = ""; const b = new Uint8Array(buf); const N = b.length; for (let i = 0; i < N; i++) bin += String.fromCharCode(b[i]); return btoa(bin); }
