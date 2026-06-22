// Cloudflare Pages Function — recebe o comprovante e grava no NocoDB.
// O token do NocoDB fica em variável de ambiente (server-side), nunca no cliente.
// Env: NOCODB_URL, NOCODB_TOKEN, NOCODB_TABLE

export async function onRequestPost(context) {
  const { request, env } = context;
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
