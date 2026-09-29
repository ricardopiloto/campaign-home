import { useCallback, useEffect, useId, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { campaignInputSchema } from '../../shared/schemas.ts'
import type {
  AdminCampaign,
  CampaignSource,
  CodexCampaign,
  ImageSource,
} from '../../shared/types.ts'
import { ApiRequestError, api } from '../api'

interface FormValues {
  source: CampaignSource
  codexSlug: string
  title: string
  tagline: string
  system: string
  ongoing: boolean
  imageUrl: string
  imageSource: ImageSource | null
  foundryUrl: string
  codexUrl: string
}

type FieldName = keyof FormValues
type FieldErrors = Partial<Record<FieldName, string>>

type CodexState =
  | { status: 'loading' }
  | { status: 'disabled' }
  | { status: 'error'; message: string }
  | { status: 'ok'; items: CodexCampaign[] }

const EMPTY: FormValues = {
  source: 'manual',
  codexSlug: '',
  title: '',
  tagline: '',
  system: '',
  ongoing: false,
  imageUrl: '',
  imageSource: null,
  foundryUrl: '',
  codexUrl: '',
}

function fromCampaign(c: AdminCampaign): FormValues {
  return {
    source: c.source,
    codexSlug: c.codexSlug ?? '',
    title: c.title,
    tagline: c.tagline,
    system: c.system,
    ongoing: c.ongoing,
    imageUrl: c.imageUrl ?? '',
    imageSource: c.imageSource,
    foundryUrl: c.foundryUrl ?? '',
    codexUrl: c.codexUrl ?? '',
  }
}

interface FieldProps {
  label: string
  error?: string
  hint?: string
  children: (props: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode
}

function Field({ label, error, hint, children }: FieldProps) {
  const id = useId()
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ')
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children({
        id,
        ...(error ? { 'aria-invalid': true as const } : {}),
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
      })}
      {hint && (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field__error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  )
}

function CampaignForm() {
  const { id } = useParams()
  const isEdit = id !== undefined
  const navigate = useNavigate()

  const [values, setValues] = useState<FormValues>(EMPTY)
  const [loaded, setLoaded] = useState(!isEdit)
  const [codex, setCodex] = useState<CodexState>({ status: 'loading' })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiRequestError) {
        if (err.status === 401) {
          navigate('/admin/login', { replace: true })
          return
        }
        if (err.field) {
          setErrors({ [err.field]: err.message })
          return
        }
      }
      setFormError(err instanceof Error ? err.message : 'Erro inesperado')
    },
    [navigate],
  )

  const loadCodex = useCallback(
    (fresh = false) => {
      setCodex({ status: 'loading' })
      api<CodexCampaign[]>('GET', `/api/admin/codex/available${fresh ? '?fresh=1' : ''}`)
        .then((items) => {
          setCodex({ status: 'ok', items })
          // Numa campanha nova, o modo vinculado é o padrão quando há o que vincular.
          if (!isEdit && items.length > 0) {
            setValues((v) => (v.source === 'manual' && !v.title ? { ...v, source: 'codex' } : v))
          }
        })
        .catch((err) => {
          if (err instanceof ApiRequestError && err.status === 503) {
            setCodex({ status: 'disabled' })
          } else if (err instanceof ApiRequestError && err.status === 401) {
            handleError(err)
          } else {
            setCodex({ status: 'error', message: 'Não foi possível carregar o catálogo do codex' })
          }
        })
    },
    [handleError, isEdit],
  )

  useEffect(() => {
    if (isEdit) {
      api<AdminCampaign[]>('GET', '/api/admin/campaigns')
        .then((list) => {
          const found = list.find((c) => c.id === id)
          if (!found) {
            setFormError('Campanha não encontrada')
          } else {
            setValues(fromCampaign(found))
          }
          setLoaded(true)
        })
        .catch(handleError)
    } else {
      loadCodex()
    }
  }, [id, isEdit, handleError, loadCodex])

  function set<K extends FieldName>(name: K, value: FormValues[K]) {
    setValues((v) => ({ ...v, [name]: value }))
    setErrors((e) => ({ ...e, [name]: undefined }))
  }

  const text = (name: FieldName) => ({
    value: values[name] as string,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(name, e.target.value),
  })

  function selectCodexCampaign(slug: string) {
    const item = codex.status === 'ok' ? codex.items.find((c) => c.slug === slug) : undefined
    setErrors({})
    if (!item) {
      set('codexSlug', '')
      return
    }
    setValues((v) => ({
      ...v,
      codexSlug: item.slug,
      title: item.title,
      system: item.system,
      codexUrl: item.codexUrl,
      imageUrl: item.imageUrl ?? '',
      imageSource: item.imageUrl ? 'codex' : null,
    }))
  }

  async function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const form = new FormData()
    form.set('file', file)
    setBusy(true)
    try {
      const { url } = await api<{ url: string }>('POST', '/api/admin/uploads', form)
      set('imageUrl', url)
      set('imageSource', 'upload')
    } catch (err) {
      handleError(err)
    } finally {
      setBusy(false)
    }
  }

  async function resync() {
    setBusy(true)
    setNotice(null)
    setFormError(null)
    try {
      const updated = await api<AdminCampaign>('POST', `/api/admin/campaigns/${id}/resync`)
      setValues((v) => ({ ...fromCampaign(updated), ongoing: v.ongoing }))
      setNotice('Sincronizado com o codex: nome, sistema, link e imagem do codex atualizados.')
    } catch (err) {
      handleError(err)
    } finally {
      setBusy(false)
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    setNotice(null)
    const parsed = campaignInputSchema.safeParse(values)
    if (!parsed.success) {
      const next: FieldErrors = {}
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as FieldName
        next[field] ??= issue.message
      }
      setErrors(next)
      return
    }
    setBusy(true)
    try {
      if (isEdit) await api('PUT', `/api/admin/campaigns/${id}`, values)
      else await api('POST', '/api/admin/campaigns', values)
      navigate('/admin')
    } catch (err) {
      handleError(err)
      setBusy(false)
    }
  }

  if (!loaded) {
    return formError ? (
      <p className="admin-alert" role="alert">
        {formError}
      </p>
    ) : (
      <p className="label-mono">Carregando…</p>
    )
  }

  const linked = values.source === 'codex'
  const showDetails = !linked || isEdit || values.codexSlug !== ''

  return (
    <section className="admin-section">
      <div className="admin-section__head">
        <h2 className="admin-section__title">{isEdit ? 'Editar campanha' : 'Nova campanha'}</h2>
        <Link className="button button--ghost" to="/admin">
          Voltar
        </Link>
      </div>

      <form className="admin-card admin-form" onSubmit={onSubmit} noValidate>
        {formError && (
          <p className="admin-alert" role="alert">
            {formError}
          </p>
        )}
        {notice && (
          <p className="admin-notice" role="status">
            {notice}
          </p>
        )}

        {isEdit ? (
          <div className="admin-form__origin">
            <span className={`tag ${linked ? 'tag--primary' : ''}`}>
              {linked ? `Vinculada ao codex: ${values.codexSlug}` : 'Cadastro manual'}
            </span>
            {linked && (
              <button type="button" className="button button--ghost" onClick={resync} disabled={busy}>
                Ressincronizar com o codex
              </button>
            )}
          </div>
        ) : (
          <fieldset className="admin-form__mode">
            <legend className="field__label">Origem</legend>
            <label className="choice">
              <input
                type="radio"
                name="source"
                checked={linked}
                disabled={codex.status === 'disabled'}
                onChange={() => {
                  setErrors({})
                  setValues({ ...EMPTY, source: 'codex' })
                }}
              />
              Vincular campanha do codex
            </label>
            <label className="choice">
              <input
                type="radio"
                name="source"
                checked={!linked}
                onChange={() => {
                  setErrors({})
                  setValues((v) => ({ ...v, source: 'manual', codexSlug: '' }))
                }}
              />
              Cadastro manual
            </label>
            {codex.status === 'disabled' && (
              <p className="field__hint">
                A integração com o codex não está configurada (CODEX_BASE_URL). Apenas o cadastro
                manual está disponível.
              </p>
            )}
          </fieldset>
        )}

        {!isEdit && codex.status === 'error' && (
          <div className="admin-alert" role="alert">
            <p>{codex.message}. O cadastro manual continua disponível.</p>
            <button type="button" className="button button--ghost" onClick={() => loadCodex(true)}>
              Tentar novamente
            </button>
          </div>
        )}

        {!isEdit && linked && (
          <div className="admin-form__codex">
            {codex.status === 'loading' && <p className="label-mono">Carregando catálogo do codex…</p>}
            {codex.status === 'ok' && codex.items.length === 0 && (
              <p className="field__hint">
                Todas as campanhas do catálogo já estão vinculadas. Campanhas "só com link" no codex
                devem ser cadastradas manualmente.
              </p>
            )}
            {codex.status === 'ok' && codex.items.length > 0 && (
              <Field
                label="Campanha do codex"
                error={errors.codexSlug}
                hint="Só aparecem campanhas listadas no catálogo público do codex e ainda não vinculadas."
              >
                {(a) => (
                  <select
                    {...a}
                    className="field__input"
                    value={values.codexSlug}
                    onChange={(e) => selectCodexCampaign(e.target.value)}
                  >
                    <option value="">Selecione…</option>
                    {codex.items.map((item) => (
                      <option key={item.slug} value={item.slug}>
                        {item.title} ({item.system || 'sem sistema'})
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
          </div>
        )}

        {showDetails && (
          <>
            <div className="admin-form__grid">
              <Field label="Nome *" error={errors.title}>
                {(a) => <input {...a} className="field__input" maxLength={120} {...text('title')} />}
              </Field>
              <Field label="Sistema" error={errors.system}>
                {(a) => (
                  <input {...a} className="field__input" maxLength={60} placeholder="PF2E" {...text('system')} />
                )}
              </Field>
              <div className="field field--inline">
                <label className="choice">
                  <input
                    type="checkbox"
                    checked={values.ongoing}
                    onChange={(e) => set('ongoing', e.target.checked)}
                  />
                  Sessão em andamento (badge "Ongoing session")
                </label>
              </div>
            </div>

            <Field label="Tagline" error={errors.tagline}>
              {(a) => <textarea {...a} className="field__input" rows={2} maxLength={300} {...text('tagline')} />}
            </Field>

            <div className="admin-form__grid">
              <Field label="Link do Foundry" error={errors.foundryUrl} hint="Instância do Foundry VTT.">
                {(a) => (
                  <input
                    {...a}
                    className="field__input"
                    type="url"
                    inputMode="url"
                    placeholder="https://…"
                    {...text('foundryUrl')}
                  />
                )}
              </Field>
              <Field
                label="Link do Codex"
                error={errors.codexUrl}
                hint={linked ? 'Derivado do codex; pode ser ajustado.' : 'Página da campanha no campaign-codex.'}
              >
                {(a) => (
                  <input
                    {...a}
                    className="field__input"
                    type="url"
                    inputMode="url"
                    placeholder="https://…/c/slug"
                    {...text('codexUrl')}
                  />
                )}
              </Field>
            </div>
            <p className="field__hint">Informe ao menos um dos dois links.</p>

            <div className="admin-form__image">
              <div className="admin-form__preview" aria-hidden="true">
                {values.imageUrl && <img src={values.imageUrl} alt="" />}
              </div>
              <div className="admin-form__image-fields">
                <Field
                  label="Imagem"
                  error={errors.imageUrl}
                  hint="URL externa ou envio de arquivo (JPEG, PNG, WebP ou SVG, até 5 MB)."
                >
                  {(a) => (
                    <input
                      {...a}
                      className="field__input"
                      type="url"
                      placeholder="https://…"
                      value={values.imageUrl}
                      onChange={(e) => {
                        set('imageUrl', e.target.value)
                        set('imageSource', 'url')
                      }}
                    />
                  )}
                </Field>
                <div className="admin-form__image-actions">
                  <label className="button button--ghost">
                    Enviar arquivo
                    <input
                      className="visually-hidden"
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      onChange={onUpload}
                      disabled={busy}
                    />
                  </label>
                  {values.imageUrl && (
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => {
                        set('imageUrl', '')
                        set('imageSource', null)
                      }}
                    >
                      Remover imagem
                    </button>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        <div className="admin-form__submit">
          <button type="submit" className="button" disabled={busy || !showDetails}>
            {busy ? 'Salvando…' : isEdit ? 'Salvar alterações' : 'Cadastrar campanha'}
          </button>
        </div>
      </form>
    </section>
  )
}

export default CampaignForm
