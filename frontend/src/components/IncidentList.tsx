import type { Incident } from '../App'

const TYPE_EMOJI: Record<string, string> = {
  fire: '🔥', flood: '🌊', earthquake: '🏚️', medical: '🏥', collapse: '🧱', other: '❓',
}

const SEVERITY_COLORS: Record<number, string> = {
  1: '#22c55e', 2: '#4ade80', 3: '#f97316', 4: '#ef4444', 5: '#991b1b',
}

interface Props {
  incidents: Incident[]
  selectedId?: string | null
  onSelect: (inc: Incident) => void
}

export default function IncidentList({ incidents, selectedId, onSelect }: Props) {
  return (
    <div className="incident-list">
      <h3>Active Incidents ({incidents.length})</h3>
      {incidents.length === 0 ? (
        <p className="empty-state">No incidents reported</p>
      ) : (
        incidents.map(inc => (
          <div
            key={inc.id}
            className={`incident-card ${selectedId === inc.id ? 'selected' : ''}`}
            onClick={() => onSelect(inc)}
          >
            <div className="card-header">
              <span className="type-badge">
                {TYPE_EMOJI[inc.type] || '❓'} {inc.type}
              </span>
              <span
                className="severity-pill"
                style={{ backgroundColor: SEVERITY_COLORS[inc.severity] || '#888' }}
              >
                L{inc.severity}
              </span>
            </div>
            <p className="card-desc">{inc.description}</p>
            <div className="card-footer">
              <span className="status-tag">{inc.status}</span>
              <span className="time-tag">
                {new Date(inc.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
