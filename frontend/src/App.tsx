import { useState } from 'react'
import { Amplify } from 'aws-amplify'
import { signOut } from '@aws-amplify/auth'
import Auth from './components/Auth'
import Dashboard from './components/Dashboard'

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_USER_POOL_ID,
      userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID,
    },
  },
})

export interface AppUser {
  email: string
  role: string
  username: string
}

export interface Incident {
  id: string
  type: string
  severity: number
  status: string
  description: string
  lat: number
  lng: number
  reportedBy: string
  createdAt: string
  photos?: string[]
}

export default function App() {
  const [user, setUser] = useState<AppUser | null>(null)

  if (!user) return <Auth onLogin={setUser} />
  return (
    <Dashboard
      user={user}
      onLogout={async () => { await signOut().catch(() => {}); setUser(null) }}
    />
  )
}
