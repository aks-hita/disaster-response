import { useState, useEffect, useMemo } from 'react'
import type { AppUser, Incident } from '../App'
import { getIncidents } from '../api'
import MapView from './MapView'
import IncidentList from './IncidentList'
import IncidentForm from './IncidentForm'

const MOCK_INCIDENTS: Incident[] = [
  { id: '1', type: 'flood', severity: 4, status: 'In Progress', description: 'River overflow near Bridge 4, evacuation ongoing', lat: 19.076, lng: 72.877, reportedBy: 'user1', createdAt: new Date(Date.now() - 3600000).toISOString() },
  { id: '2', type: 'fire', severity: 5, status: 'Reported', description: 'Industrial warehouse fire spreading to adjacent units', lat: 28.613, lng: 77.209, reportedBy: 'user2', createdAt: new Date(Date.now() - 1800000).toISOString() },
  { id: '3', type: 'medical', severity: 3, status: 'Acknowledged', description: 'Temporary medical camp urgently needs sterile water & ORS', lat: 13.082, lng: 80.270, reportedBy: 'user3', createdAt: new Date().toISOString() },
]

export default function Dashboard({ user, onLogout }: { user: AppUser; onLogout: () => void }) {
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null)
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null)

  const loadIncidents = async () => {
    try {
      const data = await getIncidents()
      setIncidents(Array.isArray(data) && data.length > 0 ? data : MOCK_INCIDENTS)
    } catch {
      setIncidents(MOCK_INCIDENTS)
    }
  }

  useEffect(() => { loadIncidents() }, [])

  const filtered = useMemo(() => incidents.filter(i => {
    if (typeFilter !== 'all' && i.type !== typeFilter) return false
    if (statusFilter !== 'all' && i.status !== statusFilter) return false
    return true
  }), [incidents, typeFilter, statusFilter])

  const handleMapClick = (lat: number, lng: number) => {
    setPin({ lat, lng })
    setShowForm(true)
  }

  return (
    <div className="dashboard-container">
      <header className="topbar">
        <div className="logo-section">
          <h2>🚨 CrisisMesh</h2>
          <span className="role-badge">{user.role.toUpperCase()}</span>
        </div>
        <div className="topbar-actions">
          <button className="btn-primary" onClick={() => setShowForm(true)}>+ Report Incident</button>
          <button className="btn-secondary" onClick={onLogout}>Logout</button>
          <div className="user-avatar">{(user.email?.[0] || 'U').toUpperCase()}</div>
        </div>
      </header>

      <div className="dashboard-body">
        <aside className="sidebar">
          <div className="filter-group">
            <label>Filter Type</label>
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
              <option value="all">All Types</option>
              {['fire', 'flood', 'earthquake', 'medical', 'collapse', 'other'].map(t => (
                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
            <label>Filter Status</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="all">All Statuses</option>
              {['Reported', 'Acknowledged', 'In Progress', 'Resolved'].map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <IncidentList
            incidents={filtered}
            selectedId={selectedIncident?.id}
            onSelect={i => setSelectedIncident(i)}
          />
        </aside>

        <main className="map-wrapper">
          <MapView
            incidents={filtered}
            showVolunteers={user.role === 'coordinator'}
            onMapClick={handleMapClick}
          />
          <div className="map-hint">Click anywhere on the map to drop an incident report pin</div>
        </main>
      </div>

      {showForm && (
        <IncidentForm
          lat={pin?.lat || null}
          lng={pin?.lng || null}
          onClose={() => { setShowForm(false); setPin(null) }}
          onCreated={loadIncidents}
        />
      )}
    </div>
  )
}
