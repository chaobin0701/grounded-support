export async function adminSession() {
  const baseUrl = process.env.EVAL_BASE_URL || 'http://localhost:8081';
  if (process.env.EVAL_ACCESS_TOKEN) return { baseUrl, token: process.env.EVAL_ACCESS_TOKEN };
  const email = process.env.EVAL_ADMIN_EMAIL;
  const password = process.env.EVAL_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('Set EVAL_ACCESS_TOKEN or EVAL_ADMIN_EMAIL and EVAL_ADMIN_PASSWORD');
  const response = await fetch(new URL('/api/admin/auth/login', baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Admin login returned HTTP ${response.status}`);
  const body = await response.json();
  if (typeof body.accessToken !== 'string') throw new Error('Admin login returned no token');
  return { baseUrl, token: body.accessToken };
}
