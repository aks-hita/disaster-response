import { fetchAuthSession } from '@aws-amplify/auth'

const API_URL = import.meta.env.VITE_API_URL

async function api(path: string, options: RequestInit = {}) {
  const session = await fetchAuthSession()
  const token = session.tokens?.idToken?.toString()
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: token } : {}),
      ...options.headers,
    },
  })
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`)
  return res.json()
}

export const getIncidents = (filters?: Record<string, string>) => {
  const qs = filters ? '?' + new URLSearchParams(filters).toString() : ''
  return api(`/incidents${qs}`)
}

export const createIncident = (data: Record<string, unknown>) =>
  api('/incidents', { method: 'POST', body: JSON.stringify(data) })

export const getPhotoUploadUrl = (incidentId: string) =>
  api(`/incidents/${incidentId}/upload-url`)

export const updateIncidentStatus = (id: string, status: string) =>
  api(`/incidents/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })

export const getVolunteers = (near?: { lat: number; lng: number }) => {
  const qs = near ? `?lat=${near.lat}&lng=${near.lng}` : ''
  return api(`/volunteers${qs}`)
}

export const createSupplyRequest = (data: Record<string, unknown>) =>
  api('/supplies/requests', { method: 'POST', body: JSON.stringify(data) })

export const createSupplyOffer = (data: Record<string, unknown>) =>
  api('/supplies/offers', { method: 'POST', body: JSON.stringify(data) })

export const sendAlert = (data: Record<string, unknown>) =>
  api('/alerts', { method: 'POST', body: JSON.stringify(data) })

export const getAlerts = () => api('/alerts')
