import { handler as apiHandler } from './api.mjs';

export default async function authBridge(req) {
  const url = new URL(req.url);
  const body = await req.text();
  const event = {
    httpMethod: req.method,
    path: url.pathname,
    headers: Object.fromEntries(req.headers.entries()),
    body: body || null,
    queryStringParameters: Object.fromEntries(url.searchParams.entries())
  };

  if (url.pathname === '/api/auth') {
    event.path = '/api/auth/login';
  }

  const result = await apiHandler(event);
  return new Response(result.body || '', {
    status: result.statusCode || 200,
    headers: result.headers || { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

export const config = {
  path: ['/api/auth', '/api/auth/:action']
};
