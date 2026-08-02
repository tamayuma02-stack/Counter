// チームのカウント状態をVercel KV(Upstash Redis)へ保存・取得する(同一チーム内の端末間引き継ぎ用)
// 同名チームの2回目以降の書き込み・読み込みは、初回に記録したパスワードハッシュと一致する場合のみ許可する
export default async function handler(req, res) {
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) {
    res.status(500).json({ error: 'KV not configured' });
    return;
  }
  const headers = { Authorization: `Bearer ${kvToken}` };

  if (req.method === 'GET' && req.query.list === '1') {
    const namesResp = await fetch(`${kvUrl}/smembers/team-index`, { headers });
    const namesData = await namesResp.json();
    const names = namesData.result || [];

    const teams = await Promise.all(names.map(async (name) => {
      const resp = await fetch(`${kvUrl}/get/${encodeURIComponent(`team:${name}`)}`, { headers });
      const data = await resp.json();
      const record = data.result ? JSON.parse(data.result) : null;
      return { name, hasPassword: !!(record && record.passwordHash) };
    }));

    res.status(200).json({ teams });
    return;
  }

  if (req.method === 'GET') {
    const { name, passwordHash } = req.query;
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const key = `team:${name}`;
    const getResp = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, { headers });
    const getData = await getResp.json();
    const existing = getData.result ? JSON.parse(getData.result) : null;

    if (!existing) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (existing.passwordHash && existing.passwordHash !== passwordHash) {
      res.status(403).json({ error: 'password mismatch' });
      return;
    }
    res.status(200).json({ count: existing.count, unitPrice: existing.unitPrice, updatedAt: existing.updatedAt });
    return;
  }

  if (req.method === 'DELETE') {
    const { name, passwordHash } = req.query;
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const key = `team:${name}`;
    const getResp = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, { headers });
    const getData = await getResp.json();
    const existing = getData.result ? JSON.parse(getData.result) : null;

    if (existing && existing.passwordHash && existing.passwordHash !== passwordHash) {
      res.status(403).json({ error: 'password mismatch' });
      return;
    }

    await fetch(`${kvUrl}/del/${encodeURIComponent(key)}`, { method: 'POST', headers });
    await fetch(`${kvUrl}/srem/team-index/${encodeURIComponent(name)}`, { headers });

    res.status(200).json({ ok: true });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const { name, count, unitPrice, passwordHash } = req.body || {};

  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  if (!Number.isFinite(count) || count < 0 || !Number.isInteger(count)) {
    res.status(400).json({ error: 'invalid count' });
    return;
  }
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    res.status(400).json({ error: 'invalid unitPrice' });
    return;
  }

  const key = `team:${name}`;

  const getResp = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, { headers });
  const getData = await getResp.json();
  const existing = getData.result ? JSON.parse(getData.result) : null;

  if (existing && existing.passwordHash && existing.passwordHash !== passwordHash) {
    res.status(403).json({ error: 'password mismatch' });
    return;
  }

  const record = { count, unitPrice, passwordHash: passwordHash || null, updatedAt: Date.now() };
  await fetch(`${kvUrl}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(record),
  });
  await fetch(`${kvUrl}/sadd/team-index/${encodeURIComponent(name)}`, { headers });

  res.status(200).json({ ok: true });
}
