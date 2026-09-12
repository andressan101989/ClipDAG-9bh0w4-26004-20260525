import { McpServer } from 'npm:@modelcontextprotocol/sdk@1.30.0/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from 'npm:@modelcontextprotocol/sdk@1.30.0/server/webStandardStreamableHttp.js'
import * as z from 'npm:zod@4.6.2'

import {
  B2_MAX_FILES,
  MCP_TOOL_DESCRIPTION,
  MCP_TOOL_METADATA,
  MCP_TOOL_NAME,
  type AdapterDependencies,
  type PublishInput,
  publishNelyonHandoff,
  safeToolError,
} from './core.ts'

const fileParamSchema = z.object({
  download_url: z.string().url(),
  file_id: z.string().min(1).max(256),
  mime_type: z.string().optional(),
  file_name: z.string().optional(),
}).strict()

const inputSchema = {
  handoff_id: z.string().optional(),
  type: z.enum(['branding', 'design', 'screenshot', 'document', 'temporary']),
  status: z.enum(['approved', 'temporary']),
  files: z.array(fileParamSchema).min(1).max(B2_MAX_FILES),
  purpose: z.string().optional(),
  expires_in_seconds: z.number().int().optional(),
}

const outputSchema = {
  handoff_id: z.string(),
  status: z.enum(['approved', 'temporary']),
  capability_url: z.string().url(),
  expires_at: z.string(),
  assets: z.array(z.object({
    filename: z.string(),
    mime_type: z.string(),
    size_bytes: z.number().int(),
    sha256: z.string(),
  })),
}

function createServer(deps: AdapterDependencies): McpServer {
  const server = new McpServer({ name: 'ai-handoff-mcp', version: '1.0.0' })
  server.registerTool(MCP_TOOL_NAME, {
    title: 'Publish Nelyon handoff',
    description: MCP_TOOL_DESCRIPTION,
    inputSchema,
    outputSchema,
    annotations: MCP_TOOL_METADATA.annotations,
    _meta: MCP_TOOL_METADATA._meta,
  }, async (input: PublishInput) => {
    try {
      const output = await publishNelyonHandoff(input, deps)
      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
      }
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Nelyon handoff was not published: ${safeToolError(error)}` }],
      }
    }
  })
  return server
}

export async function handleStreamableMcp(request: Request, deps: AdapterDependencies): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  const server = createServer(deps)
  await server.connect(transport)
  return await transport.handleRequest(request)
}
