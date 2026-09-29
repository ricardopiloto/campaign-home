import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { AdminCampaign } from '../../shared/types.ts'
import { ApiRequestError, api } from '../api'

function AdminList() {
  const navigate = useNavigate()
  const [campaigns, setCampaigns] = useState<AdminCampaign[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiRequestError && err.status === 401) {
        navigate('/admin/login', { replace: true })
        return
      }
      setError(err instanceof Error ? err.message : 'Erro inesperado')
    },
    [navigate],
  )

  const load = useCallback(() => {
    return api<AdminCampaign[]>('GET', '/api/admin/campaigns')
      .then((list) => {
        setCampaigns(list)
        setError(null)
      })
      .catch(handleError)
  }, [handleError])

  useEffect(() => {
    load()
  }, [load])

  async function move(index: number, delta: -1 | 1) {
    if (!campaigns) return
    const ids = campaigns.map((c) => c.id)
    const target = index + delta
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    setBusy(true)
    try {
      await api('PUT', '/api/admin/campaigns/order', { ids })
      await load()
    } catch (err) {
      handleError(err)
    } finally {
      setBusy(false)
    }
  }

  async function remove(campaign: AdminCampaign) {
    if (!window.confirm(`Remover "${campaign.title}" do portal? Esta ação não pode ser desfeita.`)) {
      return
    }
    setBusy(true)
    try {
      await api('DELETE', `/api/admin/campaigns/${campaign.id}`)
      await load()
    } catch (err) {
      handleError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="admin-section">
      <div className="admin-section__head">
        <h2 className="admin-section__title">Campanhas</h2>
        <Link className="button" to="/admin/new">
          Nova campanha
        </Link>
      </div>

      {error && (
        <p className="admin-alert" role="alert">
          {error}
        </p>
      )}

      {campaigns === null && !error && <p className="label-mono">Carregando…</p>}

      {campaigns?.length === 0 && (
        <div className="admin-card admin-empty">
          <p>Nenhuma campanha cadastrada. A home está exibindo o estado vazio.</p>
        </div>
      )}

      {campaigns && campaigns.length > 0 && (
        <ol className="admin-list" aria-busy={busy}>
          {campaigns.map((c, index) => (
            <li className="admin-card admin-row" key={c.id}>
              <div className="admin-row__thumb" aria-hidden="true">
                {c.imageUrl && <img src={c.imageUrl} alt="" loading="lazy" />}
              </div>
              <div className="admin-row__info">
                <p className="admin-row__title">
                  {c.title}
                  {c.ongoing && <span className="tag tag--accent">Ongoing</span>}
                </p>
                <p className="admin-row__meta">
                  <span className={`tag ${c.source === 'codex' ? 'tag--primary' : ''}`}>
                    {c.source === 'codex' ? 'Codex' : 'Manual'}
                  </span>
                  <span className={`tag ${c.foundryUrl ? '' : 'tag--off'}`}>
                    Foundry {c.foundryUrl ? '✓' : '—'}
                  </span>
                  <span className={`tag ${c.codexUrl ? '' : 'tag--off'}`}>
                    Codex {c.codexUrl ? '✓' : '—'}
                  </span>
                  {c.missingInCodex === true && (
                    <span className="tag tag--warn">Não encontrada no codex</span>
                  )}
                  {c.missingInCodex === null && (
                    <span className="tag tag--off" title="O catálogo do codex não respondeu">
                      Codex indisponível
                    </span>
                  )}
                </p>
              </div>
              <div className="admin-row__actions">
                <button
                  type="button"
                  className="button button--icon"
                  onClick={() => move(index, -1)}
                  disabled={busy || index === 0}
                  aria-label={`Mover ${c.title} para cima`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="button button--icon"
                  onClick={() => move(index, 1)}
                  disabled={busy || index === campaigns.length - 1}
                  aria-label={`Mover ${c.title} para baixo`}
                >
                  ↓
                </button>
                <Link className="button button--ghost" to={`/admin/${c.id}`}>
                  Editar
                </Link>
                <button
                  type="button"
                  className="button button--danger"
                  onClick={() => remove(c)}
                  disabled={busy}
                >
                  Remover
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

export default AdminList
