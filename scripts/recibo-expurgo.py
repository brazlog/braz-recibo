#!/usr/bin/env python3
# Expurgo LGPD — apaga comprovantes com mais de N dias (default 45). Cron diario no VPS.
# Versao versionada (SEM token). A copia viva roda no VPS em ~/saas/scripts/recibo-expurgo.py
# Token: definir env NOCODB_TOKEN (ou editar inline na copia do VPS). Ver reference_nocodb_acesso.
import json, urllib.request, datetime, sys, os
NB = os.environ.get('NOCODB_URL', 'http://localhost:8080')
TK = os.environ.get('NOCODB_TOKEN', '')   # <- no VPS a copia tem o token inline
TBL = os.environ.get('NOCODB_TABLE', 'm2t2iyvd09skmx5')
dias = 45
for a in sys.argv[1:]:
    if a.startswith('--dias='): dias = int(a.split('=')[1])
cutoff = (datetime.date.today() - datetime.timedelta(days=dias)).isoformat()
def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(NB + path, data=data, method=method,
        headers={'xc-token': TK, 'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(r, timeout=25))
stamp = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
res = req('GET', '/api/v2/tables/%s/records?where=(CreatedAt,lt,exactDate,%s)&limit=500&fields=Id' % (TBL, cutoff))
ids = [{'Id': x['Id']} for x in res.get('list', [])]
print('[%s] expurgo cutoff<%s dias=%d encontrados=%d' % (stamp, cutoff, dias, len(ids)))
if ids:
    req('DELETE', '/api/v2/tables/%s/records' % TBL, ids)
    print('[%s] apagados=%d' % (stamp, len(ids)))
