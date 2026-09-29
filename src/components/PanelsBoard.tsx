import type { CampaignsState } from '../hooks/useCampaigns'
import Panel from './Panel'

interface PanelsBoardProps {
  state: CampaignsState
  onRetry: () => void
}

function PanelsBoard({ state, onRetry }: PanelsBoardProps) {
  if (state.status === 'loading') {
    return (
      <div className="panels-state" role="status">
        <span className="status-dot" aria-hidden="true" />
        <p className="label-mono">Carregando campanhas…</p>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="panels-state" role="alert">
        <p className="panels-state__message">Não foi possível carregar as campanhas.</p>
        <button type="button" className="button" onClick={onRetry}>
          Tentar novamente
        </button>
      </div>
    )
  }

  if (state.campaigns.length === 0) {
    return (
      <div className="panels-state entrance" style={{ animationDelay: '150ms' }}>
        <p className="panels-state__message">Nenhuma campanha ativa no momento.</p>
        <p className="label-mono">Volte em breve — novos mundos estão sendo forjados.</p>
      </div>
    )
  }

  return (
    <div className="panels entrance" style={{ animationDelay: '150ms' }}>
      {state.campaigns.map((campaign, index) => (
        <Panel key={campaign.id} campaign={campaign} eager={index === 0} />
      ))}
    </div>
  )
}

export default PanelsBoard
