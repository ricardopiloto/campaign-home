import { useEffect, useState } from 'react'
import { Link, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom'
import { api } from '../api'
import AdminLogin from './AdminLogin'
import AdminList from './AdminList'
import CampaignForm from './CampaignForm'

/** Verifica a sessão antes de renderizar as telas protegidas. */
function AdminLayout() {
  const navigate = useNavigate()
  const [session, setSession] = useState<'checking' | 'ok' | 'none'>('checking')

  useEffect(() => {
    api('GET', '/api/admin/session')
      .then(() => setSession('ok'))
      .catch(() => setSession('none'))
  }, [])

  async function logout() {
    await api('POST', '/api/admin/logout').catch(() => {})
    navigate('/admin/login', { replace: true })
  }

  if (session === 'checking') return null
  if (session === 'none') return <Navigate to="/admin/login" replace />

  return (
    <div className="page admin">
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
