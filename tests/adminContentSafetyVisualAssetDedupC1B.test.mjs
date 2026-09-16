import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { VisualAssetDedupHarness } from './helpers/visualAssetDedupHarness.mjs'

const imageScans = () => [
  { id: 'post-a', mediaAssetId: 'image-x', createdAt: 1 },
  { id: 'post-b', mediaAssetId: 'image-x', createdAt: 2 },
]

test('same image across two posts has one producer, one provider call, one analysis, and one shared ID', () => {
  const harness = new VisualAssetDedupHarness({ scans: imageScans() })
  assert.equal(harness.claim(), 'post-a')
  assert.equal(harness.claim(), null)
  harness.providerResult('post-a')
  assert.equal(harness.externalProviderCalls, 1)
  assert.equal(harness.analyses.length, 1)
  assert.equal(harness.scans[0].analysisId, harness.scans[1].analysisId)
  assert.ok(harness.scans.every(scan => scan.status === 'analyzed'))
})

test('concurrent claim attempts select exactly one deterministic producer', async () => {
  const harness = new VisualAssetDedupHarness({ scans: imageScans() })
  const claims = await Promise.all([Promise.resolve().then(() => harness.claim()), Promise.resolve().then(() => harness.claim())])
  assert.deepEqual(claims.filter(Boolean), ['post-a'])
})

test('completion unique race resolves the existing asset analysis without a retry loop', () => {
  const harness = new VisualAssetDedupHarness({ scans: imageScans() })
  const producer = harness.claim()
  const result = harness.providerResult(producer, { review_required: false, findings: [] }, { beforeInsert: (state, scan) => state.insertRaceAnalysis(scan) })
  assert.equal(result.raceReused, true)
  assert.equal(harness.analyses.length, 1)
  assert.ok(harness.scans.every(scan => scan.analysisId === harness.analyses[0].id))
})

test('retry repairs a reference from an existing analysis with zero provider calls', () => {
  const harness = new VisualAssetDedupHarness({ scans: imageScans() })
  harness.providerResult(harness.claim())
  harness.scans[1].analysisId = null
  harness.scans[1].status = 'failed'
  const result = harness.retry('post-b')
  assert.equal(result.reused, true)
  assert.equal(result.providerCalls, 0)
  assert.equal(harness.externalProviderCalls, 1)
  assert.equal(harness.scans[1].analysisId, harness.analyses[0].id)
})

test('terminal producer failure is coherent and siblings never become independent jobs', () => {
  const harness = new VisualAssetDedupHarness({ scans: imageScans() })
  assert.equal(harness.claim(), 'post-a')
  harness.fail('post-a')
  assert.ok(harness.scans.every(scan => scan.status === 'failed'))
  assert.equal(harness.claim(), null)
  assert.equal(harness.retry('post-b').scanId, 'post-a')
  assert.equal(harness.claim(), 'post-a')
})

test('two posts and a shared Story reuse one image analysis', () => {
  const harness = new VisualAssetDedupHarness({ scans: [...imageScans(), { id: 'story-a', targetType: 'story', sourceScanId: 'post-a', mediaAssetId: 'image-x', createdAt: 3 }] })
  harness.providerResult(harness.claim())
  assert.equal(harness.analyses.length, 1)
  assert.ok(harness.scans.every(scan => scan.analysisId === harness.analyses[0].id))
})

test('different image assets and one repeated video asset use the correct physical identities', () => {
  const images = new VisualAssetDedupHarness({ scans: [{ id: 'a', mediaAssetId: 'x' }, { id: 'b', mediaAssetId: 'y' }] })
  images.providerResult(images.claim())
  images.providerResult(images.claim())
  assert.equal(images.analyses.length, 2)

  const videos = new VisualAssetDedupHarness({ scans: [{ id: 'v1', videoAssetId: 'video-x', createdAt: 1 }, { id: 'v2', videoAssetId: 'video-x', createdAt: 2 }] })
  videos.providerResult(videos.claim())
  assert.equal(videos.analyses.length, 1)
  assert.equal(videos.scans[0].analysisId, videos.scans[1].analysisId)
})

test('backfill attaches existing F7 analyses without provider calls or new rows', () => {
  const scans = imageScans()
  const seed = new VisualAssetDedupHarness({ scans })
  const key = ['media:image-x', 'cloudflare_workers_ai', '@cf/google/gemma-4-26b-a4b-it', 'visual-safety-v1', 'single_image_v1'].join('|')
  seed.analyses.push({ id: 'existing-analysis', sourceScanId: 'post-a', assetKey: key, result: { review_required: false, findings: [] } })
  seed.backfill()
  assert.equal(seed.analyses.length, 1)
  assert.equal(seed.externalProviderCalls, 0)
  assert.ok(seed.scans.every(scan => scan.analysisId === 'existing-analysis'))
})

test('one reused finding creates target-specific, null-confidence alerts while safe reuse creates none', () => {
  const findingHarness = new VisualAssetDedupHarness({ scans: imageScans() })
  findingHarness.providerResult(findingHarness.claim(), { review_required: true, findings: [
    { category: 'weapons' }, { category: 'weapons' },
  ] })
  assert.equal(findingHarness.alerts.length, 2)
  assert.deepEqual(new Set(findingHarness.alerts.map(alert => alert.scanId)), new Set(['post-a', 'post-b']))
  assert.ok(findingHarness.alerts.every(alert => alert.confidence === null))
  findingHarness.backfill()
  assert.equal(findingHarness.alerts.length, 2)

  const safeHarness = new VisualAssetDedupHarness({ scans: imageScans() })
  safeHarness.providerResult(safeHarness.claim(), { review_required: false, findings: [] })
  assert.equal(safeHarness.alerts.length, 0)
})

test('migration uses explicit analysis references, asset unique indexes, producer-only claims, and no forbidden authority', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260916054820_admin_content_safety_visual_asset_dedup_c1b.sql'), 'utf8')
  assert.match(sql, /add column visual_analysis_id uuid null/)
  assert.match(sql, /content_safety_visual_analyses_media_asset_unique/)
  assert.match(sql, /content_safety_visual_analyses_video_asset_unique/)
  assert.match(sql, /s\.id=private\.content_safety_visual_producer_scan_id/)
  assert.match(sql, /for update of s skip locked/)
  assert.match(sql, /on conflict do nothing/)
  assert.match(sql, /left join private\.content_safety_visual_analyses a on a\.id=s\.visual_analysis_id/)
  assert.doesNotMatch(sql, /create table|admin_issue_user_warning|admin_prepare_user_moderation_action|admin_moderate_content|financial_transactions|ledger_entries|wallets|escrow/i)
})
