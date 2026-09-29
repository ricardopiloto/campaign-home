import { useCallback, useEffect, useState } from 'react'
import type { PublicCampaign } from '../../shared/types.ts'
import { api } from '../api'

export type CampaignsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; campaigns: PublicCampaign[] }

export function useCampaigns() {
  const [state, setState] = useState<CampaignsState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    api<PublicCampaign[]>('GET', '/api/campaigns', undefined, controller.signal)
      .then((campaigns) => setState({ status: 'ready', campaigns }))
      .catch((err: Error) => {
        if (err.name !== 'AbortError') setState({ status: 'error' })
      })
    return () => controller.abort()
  }, [attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return { state, retry }
}
