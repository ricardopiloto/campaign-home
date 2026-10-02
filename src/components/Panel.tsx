import { useState } from 'react'
import { UPLOAD_PATH_RE, isHttpsUrl } from '../../shared/schemas.ts'
import type { PublicCampaign } from '../../shared/types.ts'

interface PanelProps {
  campaign: PublicCampaign
  eager?: boolean
}

function Panel({ campaign: raw, eager = false }: PanelProps) {
  // Defesa em profundidade: a API já filtra, mas o cliente também não renderiza http:.
  const https = (url: string | null) => (url && isHttpsUrl(url) ? url : null)
  const campaign = {
    ...raw,
    foundryUrl: https(raw.foundryUrl),
    codexUrl: https(raw.codexUrl),
    imageUrl: raw.imageUrl && (isHttpsUrl(raw.imageUrl) || UPLOAD_PATH_RE.test(raw.imageUrl)) ? raw.imageUrl : null,
  }
  const [imageFailed, setImageFailed] = useState(false)
  const titleId = `panel-title-${campaign.id}`
  const meta = [campaign.system && `SYSTEM: ${campaign.system}`, campaign.status]
    .filter(Boolean)
    .join(' · ')

  return (
    // tabIndex torna o painel focável: toque (mobile) e Tab expandem via :focus-within.
    <article className="panel" tabIndex={0} aria-labelledby={titleId}>
      {campaign.imageUrl && !imageFailed ? (
        <img
          className="panel__image"
          src={campaign.imageUrl}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div className="panel__image panel__image--fallback" aria-hidden="true" />
      )}
      <div className="panel__gradient" aria-hidden="true" />
      <div className="panel__border" aria-hidden="true" />

      {campaign.ongoing && (
        <span className="panel__badge label-mono">Ongoing session</span>
      )}

      <div className="panel__content">
        <h2 className="panel__title" id={titleId}>
          {campaign.title}
        </h2>
        <div className="panel-detail">
          {campaign.tagline && <p className="panel__tagline">{campaign.tagline}</p>}
          {meta && <p className="panel__meta label-mono">{meta}</p>}
          <div className="panel__actions">
            {campaign.foundryUrl && (
              <a
                className="panel__action panel__action--primary label-mono"
                href={campaign.foundryUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Abrir ${campaign.title} no Foundry VTT`}
              >
                Foundry
              </a>
            )}
            {campaign.codexUrl && (
              <a
                className="panel__action label-mono"
                href={campaign.codexUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Abrir ${campaign.title} no Campaign Codex`}
              >
                Codex
              </a>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}

export default Panel
