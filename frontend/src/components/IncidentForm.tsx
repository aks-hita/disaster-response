import { useState, FormEvent } from 'react'
import { createIncident, getPhotoUploadUrl } from '../api'

const TYPES = ['fire', 'flood', 'earthquake', 'medical', 'collapse', 'other']

interface Props {
  lat: number | null
  lng: number | null
  onClose: () => void
  onCreated: () => void
}

export default function IncidentForm({ lat, lng, onClose, onCreated }: Props) {
  const [type, setType] = useState('fire')
  const [severity, setSeverity] = useState(3)
  const [description, setDescription] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!lat || !lng) { setError('Click on the map to set location'); return }
    setLoading(true)
    setError('')
    try {
      const incident = await createIncident({ type, severity, description, lat, lng })
      if (photos.length > 0) {
        try {
          const { uploadUrls } = await getPhotoUploadUrl(incident.id)
          await Promise.all(photos.slice(0, 3).map((file, i) =>
            fetch(uploadUrls[i], { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
          ))
        } catch { /* photo upload is best-effort */ }
      }
      onCreated()
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to create incident')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-content" onClick={e => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>🚨 Report Incident</h2>
        {error && <div className="auth-error">{error}</div>}

        <label>Type</label>
        <select value={type} onChange={e => setType(e.target.value)}>
          {TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
        </select>

        <label>Severity: {severity}/5</label>
        <input type="range" min={1} max={5} value={severity} onChange={e => setSeverity(+e.target.value)} />

        <label>Description</label>
        <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)}
          placeholder="Describe the situation..." required />

        <label>Location: {lat && lng ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : 'Click on map to set'}</label>

        <label>Photos (max 3)</label>
        <input type="file" accept="image/*" multiple
          onChange={e => setPhotos(Array.from(e.target.files || []).slice(0, 3))} />

        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={loading}>{loading ? 'Submitting...' : 'Submit Report'}</button>
        </div>
      </form>
    </div>
  )
}
