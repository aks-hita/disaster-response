import { useState, FormEvent } from 'react'
import { signUp, signIn, confirmSignUp } from '@aws-amplify/auth'
import type { AppUser } from '../App'

type Mode = 'login' | 'register' | 'confirm'

export default function Auth({ onLogin }: { onLogin: (u: AppUser) => void }) {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('victim')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'register') {
        localStorage.setItem(`role_${email}`, role)
        const { isSignUpComplete } = await signUp({
          username: email,
          password,
          options: {
            userAttributes: {
              email,
              name: email.split('@')[0],
            },
          },
        })
        if (isSignUpComplete) {
          await doLogin()
        } else {
          setMode('confirm')
        }
      } else if (mode === 'confirm') {
        await confirmSignUp({ username: email, confirmationCode: code })
        await doLogin()
      } else {
        await doLogin()
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  const doLogin = async () => {
    const result = await signIn({ username: email, password })
    if (result.isSignedIn) {
      const savedRole = localStorage.getItem(`role_${email}`) || role || 'victim'
      onLogin({ email, role: savedRole, username: email })
    }
  }

  return (
    <div className="auth-container">
      <form className="auth-form" onSubmit={handleSubmit}>
        <h1>🚨 Disaster Response</h1>
        <h2>{mode === 'confirm' ? 'Confirm Email' : mode === 'login' ? 'Sign In' : 'Register'}</h2>
        {error && <div className="auth-error">{error}</div>}

        {mode === 'confirm' ? (
          <input type="text" placeholder="Confirmation code" value={code}
            onChange={e => setCode(e.target.value)} required />
        ) : (
          <>
            <input type="email" placeholder="Email" value={email}
              onChange={e => setEmail(e.target.value)} required />
            <input type="password" placeholder="Password" value={password}
              onChange={e => setPassword(e.target.value)} required minLength={8} />
            {mode === 'register' && (
              <select value={role} onChange={e => setRole(e.target.value)}>
                <option value="victim">Victim</option>
                <option value="volunteer">Volunteer</option>
                <option value="coordinator">Coordinator</option>
              </select>
            )}
          </>
        )}

        <button type="submit" disabled={loading}>
          {loading ? 'Please wait...' : mode === 'confirm' ? 'Confirm' : mode === 'login' ? 'Sign In' : 'Register'}
        </button>

        {mode !== 'confirm' && (
          <p className="auth-toggle">
            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
            <a href="#" onClick={e => { e.preventDefault(); setMode(mode === 'login' ? 'register' : 'login') }}>
              {mode === 'login' ? 'Register' : 'Sign In'}
            </a>
          </p>
        )}
      </form>
    </div>
  )
}
