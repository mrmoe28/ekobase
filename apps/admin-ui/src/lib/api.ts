import { getToken } from './auth'

const BASE_URL = '/api/admin'

export type User = {
  id: string
  email: string
  created_at: string
  updated_at: string
}

export type Tenant = {
  id: string
  name: string
  owner_id: string
  created_at: string
  updated_at: string
}

export type Stats = {
  users: number
  buckets: number
  files: number
  projects: number
}

export type Project = {
  id: string
  name: string
  description: string | null
  owner_id: string | null
  owner_email: string | null
  region: string
  created_at: string
  updated_at: string
}

export type ImpersonateResult = {
  access_token: string
  token_type: string
  expires_in: number
  user: User
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken()
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token ?? ''}`,
      ...(options.headers ?? {}),
    },
  })

  if (res.status === 204) {
    return {} as T
  }

  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    const message =
      (data as { error?: string }).error ??
      `Request failed with status ${res.status}`
    throw new Error(message)
  }

  return data as T
}

// Health
export const getHealth = () => request<{ status: string }>('/health')

// Stats
export const getStats = () => request<Stats>('/stats')

// Users
export const listUsers = () => request<User[]>('/users')
export const getUser = (userId: string) => request<User>(`/users/${userId}`)
export const createUser = (email: string, password: string) =>
  request<User>('/users', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
export const deleteUser = (userId: string) =>
  request<object>(`/users/${userId}`, { method: 'DELETE' })
export const impersonateUser = (userId: string) =>
  request<ImpersonateResult>(`/users/${userId}/impersonate`)

// Projects
export const listProjects = () => request<Project[]>('/projects')
export const getProject = (projectId: string) => request<Project>(`/projects/${projectId}`)
export const createProject = (body: { name: string; description?: string; owner_id?: string; region?: string }) =>
  request<Project>('/projects', { method: 'POST', body: JSON.stringify(body) })
export const updateProject = (projectId: string, body: { name?: string; description?: string | null; owner_id?: string | null; region?: string }) =>
  request<Project>(`/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteProject = (projectId: string) =>
  request<object>(`/projects/${projectId}`, { method: 'DELETE' })
export const getProjectKeys = (projectId: string) =>
  request<{ anon_key: string; service_role_key: string }>(`/projects/${projectId}/keys`)
export const listProjectMembers = (projectId: string) => request<User[]>(`/projects/${projectId}/members`)
export const addProjectMember = (projectId: string, user_id: string) =>
  request<User>(`/projects/${projectId}/members`, { method: 'POST', body: JSON.stringify({ user_id }) })
export const removeProjectMember = (projectId: string, userId: string) =>
  request<object>(`/projects/${projectId}/members/${userId}`, { method: 'DELETE' })

// SQL + Schema
export type QueryField = { name: string; dataTypeID: number }

export type QueryResult = {
  rows: Record<string, unknown>[]
  fields: QueryField[]
  rowCount: number | null
  command: string
}

export type ColumnInfo = {
  schema: string
  table: string
  column: string
  type: string
  nullable: boolean
  default: string | null
  position: number
  is_pk: boolean
}

export type SchemaMap = Record<string, Record<string, ColumnInfo[]>>

export type TableData = {
  rows: Record<string, unknown>[]
  total: number
  fields: QueryField[]
}

export const executeSql = (query: string) =>
  request<QueryResult>('/sql', { method: 'POST', body: JSON.stringify({ query }) })

export const getSchemaTables = () =>
  request<SchemaMap>('/schema/tables')

export const getTableRows = (schema: string, table: string, limit = 50, offset = 0) =>
  request<TableData>(`/schema/${schema}/${table}/rows?limit=${limit}&offset=${offset}`)

export const deleteTableRow = (schema: string, table: string, pk: Record<string, unknown>) =>
  request<object>(`/schema/${schema}/${table}/rows`, {
    method: 'DELETE',
    body: JSON.stringify({ pk }),
  })

export const updateTableRow = (
  schema: string,
  table: string,
  pk: Record<string, unknown>,
  data: Record<string, unknown>,
) =>
  request<Record<string, unknown>>(`/schema/${schema}/${table}/rows`, {
    method: 'PATCH',
    body: JSON.stringify({ pk, data }),
  })

// Function secrets
export type FunctionSecret = {
  name: string
  digest: string
  updated_at: string
}

export const listSecrets = () => request<FunctionSecret[]>('/secrets')
export const upsertSecrets = (secrets: { name: string; value: string }[]) =>
  request<object>('/secrets', { method: 'POST', body: JSON.stringify({ secrets }) })
export const deleteSecret = (name: string) =>
  request<object>(`/secrets/${encodeURIComponent(name)}`, { method: 'DELETE' })

// Tenants
export const listTenants = () => request<Tenant[]>('/tenants')
export const createTenant = (name: string, ownerId: string) =>
  request<Tenant>('/tenants', {
    method: 'POST',
    body: JSON.stringify({ name, ownerId }),
  })
export const deleteTenant = (tenantId: string) =>
  request<object>(`/tenants/${tenantId}`, { method: 'DELETE' })
