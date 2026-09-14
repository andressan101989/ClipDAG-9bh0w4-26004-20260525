export function normalizeContentSafetyText(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('und').replace(/\s+/gu, ' ').trim()
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

export function matchTextRule(input, rule) {
  if (!rule?.id || !rule?.code || !Array.isArray(rule.scopes)) return null
  const text = normalizeContentSafetyText(input.text)
  const pattern = normalizeContentSafetyText(rule.pattern)
  if (!text || !pattern || !rule.scopes.includes(input.scope)) return null
  if (rule.detector_type === 'keyword' && /\s/u.test(pattern)) return null
  if (rule.detector_type !== 'keyword' && rule.detector_type !== 'phrase') return null
  const expression = escapeRegExp(pattern).replace(/\s+/gu, '\\s+')
  const matcher = new RegExp(`(?:^|[^\\p{L}\\p{N}_])(${expression})(?=$|[^\\p{L}\\p{N}_])`, 'u')
  const match = matcher.exec(text)
  if (!match) return null
  const matched = match[1]
  const start = Math.max(0, (match.index + match[0].indexOf(matched)) - 90)
  const end = Math.min(text.length, start + 240)
  return {
    rule_id: rule.id,
    excerpt: text.slice(start, end),
    matched_terms: [matched],
  }
}

export function evaluateTextRules(input, rules) {
  return rules.map(rule => matchTextRule(input, rule)).filter(Boolean)
}
