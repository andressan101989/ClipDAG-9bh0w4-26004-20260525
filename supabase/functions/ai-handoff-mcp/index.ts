import {
  type AdapterDependencies,
  createAuthenticatedMcpHandler,
} from './core.ts'
import { handleStreamableMcp } from './server.ts'

const deps: AdapterDependencies = {
  env: (name) => Deno.env.get(name),
  fetchImpl: fetch,
  async resolveHostname(hostname) {
    const answers = await Promise.allSettled([
      Deno.resolveDns(hostname, 'A'),
      Deno.resolveDns(hostname, 'AAAA'),
    ])
    return answers.flatMap((answer) => answer.status === 'fulfilled' ? answer.value : [])
  },
  reportError: (name) => console.error('[ai-handoff-mcp] request failed', name),
}

const handler = createAuthenticatedMcpHandler(deps, async (request) => {
  const url = new URL(request.url)
  const marker = '/ai-handoff-mcp'
  const index = url.pathname.indexOf(marker)
  const route = index < 0 ? '' : url.pathname.slice(index + marker.length)
  if (route !== '/mcp') {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  }
  return await handleStreamableMcp(request, deps)
})

Deno.serve(handler)
