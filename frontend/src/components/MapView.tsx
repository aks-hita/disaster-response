import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import type { Incident } from '../App'

const SEVERITY_COLORS: Record<number, string> = {
  1: '#22c55e', 2: '#4ade80', 3: '#f97316', 4: '#ef4444', 5: '#991b1b',
}

function makeIcon(color: string, shape = 'circle') {
  const svg = shape === 'diamond'
    ? `<svg width="20" height="20" viewBox="0 0 20 20"><polygon points="10,0 20,10 10,20 0,10" fill="${color}" stroke="#fff" stroke-width="2"/></svg>`
    : `<svg width="16" height="16"><circle cx="8" cy="8" r="7" fill="${color}" stroke="#fff" stroke-width="2"/></svg>`
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [shape === 'diamond' ? 20 : 16, shape === 'diamond' ? 20 : 16],
    iconAnchor: [shape === 'diamond' ? 10 : 8, shape === 'diamond' ? 10 : 8],
  })
}

const TYPE_EMOJI: Record<string, string> = {
  fire: '🔥', flood: '🌊', earthquake: '🏚️', medical: '🏥', collapse: '🧱', other: '❓',
}

function ClickHandler({ onMapClick }: { onMapClick?: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) { onMapClick?.(e.latlng.lat, e.latlng.lng) },
  })
  return null
}

interface Props {
  incidents: Incident[]
  volunteers?: { lat: number; lng: number; name: string }[]
  showVolunteers?: boolean
  onMapClick?: (lat: number, lng: number) => void
}

export default function MapView({ incidents, volunteers, showVolunteers, onMapClick }: Props) {
  return (
    <MapContainer center={[20.5, 78.9]} zoom={5} className="map-container">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickHandler onMapClick={onMapClick} />
      {incidents.map(inc => (
        <Marker key={inc.id} position={[inc.lat, inc.lng]}
          icon={makeIcon(SEVERITY_COLORS[inc.severity] || '#888')}>
          <Popup>
            <strong>{TYPE_EMOJI[inc.type] || '❓'} {inc.type.toUpperCase()}</strong><br />
            Severity: {inc.severity}/5 | Status: {inc.status}<br />
            {inc.description.slice(0, 100)}
          </Popup>
        </Marker>
      ))}
      {showVolunteers && volunteers?.map((v, i) => (
        <Marker key={`vol-${i}`} position={[v.lat, v.lng]}
          icon={makeIcon('#3b82f6', 'diamond')}>
          <Popup>{v.name} (Volunteer)</Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}
