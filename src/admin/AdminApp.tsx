import { useState } from 'react'
import { Link, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom'
import { api } from '../api'
import AdminLogin from './AdminLogin'
import AdminList from './AdminList'
import CampaignForm from './CampaignForm'
import { useAdminSession } from './useAdminSession'

/** Verifica a sessão antes de renderizar as telas protegidas. */
function AdminLayout() {
  const navigate = useNavigate()
  const { state, ready, retry } = useAdminSession()
  const [logoutError, setLogoutError] = useState<string | null>(null)

  async function logout() {
    try {
      await api('POST', '/api/admin/logout')
      navigate('/admin/login', { replace: true })
    } catch {
      setLogoutError('Não foi possível sair. Verifique a conexão e tente novamente.')
    }
  }

  if (state === 'expired') return <Navigate to="/admin/login" replace state={{ sessionExpired: true }} />

  return (
    <div className="page admin">
      {state === 'checking' && <p role="status">Verificando sessão…</p>}
      {state === 'unavailable' && (
        <div role="alert">
          <p>Não foi possível verificar a sessão. Verifique a conexão.</p>
          <button className="button" type="button" onClick={retry}>Tentar novamente</button>
        </div>
      )}
      {logoutError && <p role="alert">{logoutError}</p>}
      {ready && <fieldset disabled={state !== 'ok'} ref={(element) => {
        if (element) element.inert = state !== 'ok'
      }} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <header className="admin-header">
        <div>
          <p className="label-mono">FOUNDRY GATEWAY</p>
          <h1 className="display-title">Gestão de campanhas</h1>
        </div>
        <nav className="admin-header__nav" aria-label="Navegação do admin">
          <Link className="label-mono" to="/admin">
            Campanhas
          </Link>
          <a className="label-mono" href="/" target="_blank" rel="noopener noreferrer">
            Ver portal
          </a>
          <button type="button" className="button button--ghost" onClick={logout}>
            Sair
          </button>
        </nav>
      </header>
      <main className="admin-main">
        <Outlet />
      </main>
      </fieldset>}
    </div>
  )
}

function AdminApp() {
  return (
    <Routes>
      <Route path="login" element={<AdminLogin />} />
      <Route element={<AdminLayout />}>
        <Route index element={<AdminList />} />
        <Route path="new" element={<CampaignForm />} />
        <Route path=":id" element={<CampaignForm />} />
      </Route>
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  )
}

export default AdminApp
