import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiRequestError, api } from '../api'

function AdminLogin() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await api('POST', '/api/admin/login', { password })
      navigate('/admin', { replace: true })
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Erro inesperado')
      setSubmitting(false)
    }
  }

  return (
    <div className="page admin admin-login">
      <form className="admin-card admin-login__card" onSubmit={onSubmit}>
        <p className="label-mono">FOUNDRY GATEWAY</p>
        <h1 className="display-title">Área de gestão</h1>
        <label className="field">
          <span className="field__label">Senha</span>
          <input
            className="field__input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'login-error' : undefined}
          />
        </label>
        {error && (
          <p className="field__error" id="login-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button" disabled={submitting}>
          {submitting ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}

export default AdminLogin
