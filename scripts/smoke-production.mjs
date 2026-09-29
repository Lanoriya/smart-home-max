const baseUrl = process.env.SMOKE_BASE_URL?.replace(/\/$/, '');
const username = process.env.SMOKE_ADMIN_USERNAME;
const password = process.env.SMOKE_ADMIN_PASSWORD;

if (!baseUrl || !username || !password) {
  console.error('Set SMOKE_BASE_URL, SMOKE_ADMIN_USERNAME and SMOKE_ADMIN_PASSWORD.');
  process.exit(2);
}
if (!baseUrl.startsWith('https://') && process.env.SMOKE_ALLOW_HTTP !== 'true') {
  console.error('SMOKE_BASE_URL must use HTTPS. Set SMOKE_ALLOW_HTTP=true only for a local check.');
  process.exit(2);
}

async function expectJson(path, options = {}, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(10_000),
    ...options,
    headers: { Accept: 'application/json', ...(options.headers ?? {}) },
  });
  if (response.status !== expectedStatus) {
    throw new Error(`${options.method ?? 'GET'} ${path}: expected ${expectedStatus}, received ${response.status}`);
  }
  const body = response.status === 204 ? null : await response.json();
  return { response, body };
}

try {
  const live = await expectJson('/health/live');
  if (live.body?.status !== 'ok') throw new Error('Unexpected live response');
  const ready = await expectJson('/health/ready');
  if (ready.body?.status !== 'ready') throw new Error('Unexpected ready response');

  const login = await expectJson('/api/admin/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const cookie = login.response.headers.get('set-cookie')?.split(';', 1)[0];
  if (!cookie || !login.body?.admin?.id) throw new Error('Login did not return a session');

  const incidents = await expectJson('/api/incidents', { headers: { Cookie: cookie } });
  if (!Array.isArray(incidents.body?.items)) throw new Error('Incident list has an invalid shape');
  await expectJson('/api/admin/session', { method: 'DELETE', headers: { Cookie: cookie } }, 204);

  console.log(`Smoke test passed. Incidents available: ${incidents.body.items.length}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
