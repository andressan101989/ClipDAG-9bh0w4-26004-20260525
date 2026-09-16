const PROVIDER = 'cloudflare_workers_ai'
const MODEL = '@cf/google/gemma-4-26b-a4b-it'
const PROMPT = 'visual-safety-v1'

const strategyFor = scan => scan.mediaAssetId ? 'single_image_v1' : 'percentile_5_v1'
const assetKey = scan => [scan.mediaAssetId ? `media:${scan.mediaAssetId}` : `video:${scan.videoAssetId}`, PROVIDER, MODEL, PROMPT, strategyFor(scan)].join('|')

export class VisualAssetDedupHarness {
  constructor({ scans = [], analyses = [] } = {}) {
    this.scans = scans.map((scan, index) => ({
      targetType: 'video', status: 'pending', createdAt: index + 1, attempts: 0,
      providerCalls: 0, analysisId: null, sourceScanId: null, lease: false, ...scan,
    }))
    this.analyses = analyses.map(value => ({ ...value }))
    this.alerts = []
    this.externalProviderCalls = 0
    this.nextAnalysis = analyses.length + 1
  }

  analysisFor(scan) {
    const key = assetKey(scan)
    return this.analyses.find(analysis => analysis.assetKey === key) ?? null
  }

  producerFor(scan) {
    return this.scans
      .filter(candidate => candidate.targetType === 'video' && assetKey(candidate) === assetKey(scan))
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))[0] ?? null
  }

  claim() {
    const candidate = this.scans
      .filter(scan => scan.targetType === 'video' && scan.status === 'pending' && !scan.analysisId && !scan.lease && !this.analysisFor(scan) && this.producerFor(scan)?.id === scan.id)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))[0]
    if (!candidate) return null
    candidate.lease = true
    candidate.attempts += 1
    return candidate.id
  }

  providerResult(scanId, result = { review_required: false, findings: [] }, options = {}) {
    const scan = this.scans.find(value => value.id === scanId)
    if (!scan || !scan.lease || this.producerFor(scan)?.id !== scan.id) throw new Error('not_canonical_producer')
    this.externalProviderCalls += 1
    const prior = this.analysisFor(scan)
    if (prior) return this.attach(prior)
    options.beforeInsert?.(this, scan)
    const raced = this.analysisFor(scan)
    if (raced) return { ...this.attach(raced), raceReused: true }
    const analysis = {
      id: `analysis-${this.nextAnalysis++}`,
      sourceScanId: scan.id,
      assetKey: assetKey(scan),
      result,
    }
    this.analyses.push(analysis)
    return { ...this.attach(analysis), raceReused: false }
  }

  insertRaceAnalysis(scan, result = { review_required: false, findings: [] }) {
    if (this.analysisFor(scan)) return
    this.analyses.push({ id: `analysis-${this.nextAnalysis++}`, sourceScanId: scan.id, assetKey: assetKey(scan), result })
  }

  attach(analysis) {
    const sources = this.scans.filter(scan => scan.targetType === 'video' && assetKey(scan) === analysis.assetKey)
    for (const scan of sources) {
      scan.analysisId = analysis.id
      scan.status = 'analyzed'
      scan.lease = false
      for (const finding of analysis.result.findings ?? []) {
        const alertKey = `${scan.id}|${analysis.id}|${finding.category}|${PROMPT}`
        if (!this.alerts.some(alert => alert.key === alertKey)) this.alerts.push({ key: alertKey, scanId: scan.id, analysisId: analysis.id, category: finding.category, confidence: null })
      }
    }
    for (const story of this.scans.filter(scan => scan.targetType === 'story')) {
      const source = this.scans.find(scan => scan.id === story.sourceScanId)
      if (source && assetKey(source) === analysis.assetKey) {
        story.analysisId = analysis.id
        story.status = 'analyzed'
      }
    }
    return { analysisId: analysis.id, scansAttached: sources.length }
  }

  fail(scanId, { retryable = false } = {}) {
    const scan = this.scans.find(value => value.id === scanId)
    if (!scan || this.producerFor(scan)?.id !== scan.id) throw new Error('not_canonical_producer')
    const status = retryable ? 'pending' : 'failed'
    for (const sibling of this.scans.filter(value => value.targetType === 'video' && assetKey(value) === assetKey(scan))) {
      sibling.status = status
      sibling.lease = false
    }
    for (const story of this.scans.filter(value => value.targetType === 'story')) {
      const source = this.scans.find(value => value.id === story.sourceScanId)
      if (source && assetKey(source) === assetKey(scan)) story.status = status
    }
  }

  retry(scanId) {
    const requested = this.scans.find(value => value.id === scanId)
    const source = requested?.targetType === 'story' ? this.scans.find(value => value.id === requested.sourceScanId) : requested
    if (!source) throw new Error('scan_not_found')
    const analysis = this.analysisFor(source)
    if (analysis) return { ...this.attach(analysis), providerCalls: 0, reused: true }
    const producer = this.producerFor(source)
    if (!producer || producer.status !== 'failed') throw new Error('not_failed')
    for (const sibling of this.scans.filter(value => value.targetType === 'video' && assetKey(value) === assetKey(source))) sibling.status = 'pending'
    producer.attempts = 0
    producer.providerCalls = 0
    return { scanId: producer.id, providerCalls: 0, reused: false }
  }

  backfill() {
    for (const analysis of this.analyses) this.attach(analysis)
  }
}

export const visualAssetKey = assetKey
