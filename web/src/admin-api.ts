export interface AdminMe {
  id: number;
  email: string;
  displayName: string;
  roles: { id: number; code: string; name: string }[];
  permissionCodes: string[];
}

export interface DocumentItem {
  id: number;
  title: string;
  originalFilename: string;
  byteSize: number;
  uploadedBy: number;
  status: string;
  errorMessage: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentDetail extends DocumentItem {
  extractedText: string | null;
  chunkCount: number;
}

export interface DocumentChunk {
  id: number;
  ordinal: number;
  headingPath: string;
  content: string;
  sourceStartLine: number;
  sourceEndLine: number;
}

export interface RoleItem {
  id: number;
  code: string;
  name: string;
  isSystem: boolean;
  permissionCodes: string[];
}

export interface AdminItem {
  id: number;
  email: string;
  displayName: string;
  disabledAt: string | null;
  roles: { id: number; code: string }[];
}

export interface PermissionItem { code: string; description: string }
export interface AuditItem {
  id: number;
  actorAdminId: number;
  action: string;
  targetType: string;
  targetId: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export class AdminApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(`/api/admin${path}`, { ...options, headers, cache: 'no-store' });
  } catch {
    throw new AdminApiError(0, '网络连接失败，请重试');
  }
  if (!response.ok) {
    let message = `请求失败（HTTP ${response.status}）`;
    try {
      const body = await response.json() as { message?: string | string[] };
      if (typeof body.message === 'string') message = body.message;
      else if (Array.isArray(body.message)) message = body.message.join('；');
    } catch { /* Keep the HTTP status if the server did not return JSON. */ }
    throw new AdminApiError(response.status, message);
  }
  return response.json() as Promise<T>;
}

export const adminApi = {
  login: (email: string, password: string) => request<{ accessToken: string; expiresIn: number }>('/auth/login', {
    method: 'POST', body: JSON.stringify({ email, password }),
  }),
  me: (token: string) => request<AdminMe>('/auth/me', {}, token),
  documents: (token: string, offset: number) => request<DocumentItem[]>(`/documents?limit=50&offset=${offset}`, {}, token),
  document: (token: string, id: number) => request<DocumentDetail>(`/documents/${id}`, {}, token),
  chunks: (token: string, id: number) => request<DocumentChunk[]>(`/documents/${id}/chunks`, {}, token),
  upload: (token: string, file: File, title: string) => {
    const body = new FormData();
    body.append('file', file);
    if (title.trim()) body.append('title', title.trim());
    return request<{ id: number; status: string }>('/documents', { method: 'POST', body }, token);
  },
  archive: (token: string, id: number) => request(`/documents/${id}/archive`, { method: 'PATCH' }, token),
  retry: (token: string, id: number) => request(`/documents/${id}/retry`, { method: 'POST' }, token),
  reprocess: (token: string, id: number) => request(`/documents/${id}/reprocess`, { method: 'POST' }, token),
  roles: (token: string) => request<RoleItem[]>('/roles', {}, token),
  permissions: (token: string) => request<PermissionItem[]>('/permissions', {}, token),
  createRole: (token: string, input: { code: string; name: string; permissionCodes: string[] }) => request('/roles', { method: 'POST', body: JSON.stringify(input) }, token),
  updateRole: (token: string, id: number, input: { name: string; permissionCodes: string[] }) => request(`/roles/${id}`, { method: 'PATCH', body: JSON.stringify(input) }, token),
  admins: (token: string) => request<AdminItem[]>('/admins', {}, token),
  createAdmin: (token: string, input: { email: string; displayName: string; password: string; roleIds: number[] }) => request('/admins', { method: 'POST', body: JSON.stringify(input) }, token),
  assignRoles: (token: string, id: number, roleIds: number[]) => request(`/admins/${id}/roles`, { method: 'PATCH', body: JSON.stringify({ roleIds }) }, token),
  setStatus: (token: string, id: number, disabled: boolean) => request(`/admins/${id}/status`, { method: 'PATCH', body: JSON.stringify({ disabled }) }, token),
  audit: (token: string) => request<AuditItem[]>('/audit?limit=50', {}, token),
};
