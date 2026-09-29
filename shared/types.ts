// Tipos compartilhados entre o servidor (server/) e o front (src/).

export type CampaignSource = 'codex' | 'manual'
export type ImageSource = 'codex' | 'upload' | 'url'

/** Campos expostos publicamente em GET /api/campaigns. */
export interface PublicCampaign {
  id: string
  title: string
  tagline: string
  system: string
  status: string
  ongoing: boolean
  imageUrl: string | null
  foundryUrl: string | null
  codexUrl: string | null
}

/** Campanha completa, como vista pela área de gestão. */
export interface AdminCampaign extends PublicCampaign {
  source: CampaignSource
  codexSlug: string | null
  imageSource: ImageSource | null
  sortOrder: number
  createdAt: string
  updatedAt: string
  /** true/false para campanhas vinculadas; null quando o codex não respondeu. Sempre false para manuais. */
  missingInCodex: boolean | null
}

/** Campanha disponível no catálogo do codex, já mapeada para os campos do gateway. */
export interface CodexCampaign {
  slug: string
  title: string
  system: string
  imageUrl: string | null
  codexUrl: string
}

export interface ApiError {
  error: string
  field?: string
}
