import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import { TOOL_DEFINITIONS, ToolName } from '../domain/tools'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface InlineAttachment {
  base64: string
  contentType: string
}

export interface PendingToolCall {
  name: ToolName
  args: Record<string, unknown>
}

export interface LlmTurnResult {
  reply: string
  pendingTool?: PendingToolCall
  needsConfirmation: boolean
}

const WRITE_TOOLS = new Set<ToolName>([
  'create_customer',
  'create_order',
  'update_order_status',
  'log_purchase',
  'log_production',
  'create_supplier',
  'create_material',
  'assign_work',
])

const SYSTEM = `You are the Paper&Purpose CRM assistant for a paper-craft / party decoration business.
Help staff log purchases, production, orders, and status updates using tools.
Always resolve names to IDs via find_* tools before write tools. Never show Firestore document IDs in replies — use human names, status, and event type.
When a lookup returns a list, do not reprint it as numbered text or pipes. Add at most one short follow-up question.
After a lookup succeeds, continue with the user's request (e.g. log production once you have productId and productVersionId).
You can create suppliers, materials, and customers inline when they do not exist.
If the user names a new material, call create_material immediately with that name and unit pcs unless they specified another unit. Do not ask for cost or GST unless they provided them.
For production, capture expected vs actual quantity and optional orderId. GST rates are Indian slabs 0/5/12/18/28.
Pass gstRate on order and purchase line items when known (from the bill, material, or product). Include gstin when creating customers.
Use find_worker to resolve worker names to IDs before assign_work.
Use analyze_product to estimate how many units can be built, cost, and storage notes.
For any write (create_*, log_*, update_order_status, assign_work), call the tool with the final arguments — the app will ask the user to confirm before committing.
Keep replies short and practical. Currency is INR (₹). Prices are taxable; GST is added on purchases and orders.
If information is missing, ask a brief clarifying question instead of guessing IDs.
For tools that take items arrays, pass structured JSON objects in the args.
If the user attaches a bill or invoice image, read the supplier, materials, quantities, unit costs, and GST from it and use those values.`

const WORKER_SYSTEM = `
This user is a shop-floor worker. Never mention prices, costs, totals, profit, GST amounts, or selling prices. Do not ask for cost or GST. Only discuss quantities, names, status, and assigned work.`

function buildToolDeclarations() {
  return TOOL_DEFINITIONS.map(t => {
    const properties: Record<string, { type: SchemaType; description?: string }> = {}
    for (const [key, val] of Object.entries(t.parameters.properties)) {
      const v = val as { type: string; description?: string }
      if (v.type === 'number') {
        properties[key] = { type: SchemaType.NUMBER, description: v.description }
      } else if (v.type === 'array') {
        // Pass complex arrays as a JSON string; orchestrator will parse
        properties[key] = {
          type: SchemaType.STRING,
          description: `${v.description ?? key} as JSON string`,
        }
      } else {
        properties[key] = { type: SchemaType.STRING, description: v.description }
      }
    }
    return {
      name: t.name,
      description: t.description,
      parameters: {
        type: SchemaType.OBJECT,
        properties,
        required: (t.parameters as { required?: string[] }).required ?? [],
      },
    }
  })
}

function normalizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args }
  for (const key of ['items', 'workerIds']) {
    if (typeof out[key] === 'string') {
      try {
        out[key] = JSON.parse(out[key] as string)
      } catch {
        /* leave as-is */
      }
    }
  }
  if (out.limit != null) out.limit = Number(out.limit)
  if (out.quantity != null) out.quantity = Number(out.quantity)
  if (out.expectedQuantity != null) out.expectedQuantity = Number(out.expectedQuantity)
  if (out.actualQuantity != null) out.actualQuantity = Number(out.actualQuantity)
  if (out.discount != null) out.discount = Number(out.discount)
  if (out.gstRate != null) out.gstRate = Number(out.gstRate)
  if (out.costPerUnit != null) out.costPerUnit = Number(out.costPerUnit)
  return out
}

export async function runLlmTurn(params: {
  apiKey: string
  model: string
  messages: ChatMessage[]
  role: string
  attachments?: InlineAttachment[]
}): Promise<LlmTurnResult> {
  const genAI = new GoogleGenerativeAI(params.apiKey)
  const model = genAI.getGenerativeModel({
    model: params.model,
    systemInstruction: `${SYSTEM}\nUser role: ${params.role}${params.role === 'worker' ? WORKER_SYSTEM : ''}`,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: [{ functionDeclarations: buildToolDeclarations() as any }],
  })

  const history = params.messages
    .filter(m => m.role !== 'system')
    .slice(0, -1)
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))

  const last = params.messages[params.messages.length - 1]
  const chat = model.startChat({ history })

  const parts_: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [
    { text: last?.content ?? '' },
  ]
  for (const att of params.attachments ?? []) {
    parts_.push({ inlineData: { data: att.base64, mimeType: att.contentType } })
  }

  const result = await chat.sendMessage(parts_)
  const response = result.response
  const candidate = response.candidates?.[0]
  const parts = candidate?.content?.parts ?? []

  const fn = parts.find(p => 'functionCall' in p && p.functionCall)
  if (fn && 'functionCall' in fn && fn.functionCall) {
    const name = fn.functionCall.name as ToolName
    const args = normalizeArgs((fn.functionCall.args ?? {}) as Record<string, unknown>)
    const needsConfirmation = WRITE_TOOLS.has(name)
    const summary = needsConfirmation
      ? `I can run **${name}** with:\n\`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\`\nReply **yes** to confirm or **no** to cancel.`
      : `Looking that up…`
    return {
      reply: summary,
      pendingTool: { name, args },
      needsConfirmation,
    }
  }

  const text = parts
    .map(p => ('text' in p ? p.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim()

  return {
    reply: text || 'Sorry, I could not understand that. Try again.',
    needsConfirmation: false,
  }
}

export async function runLlmFollowUp(params: {
  apiKey: string
  model: string
  messages: ChatMessage[]
  role: string
  toolName: ToolName
  toolArgs: Record<string, unknown>
  toolResult: unknown
}): Promise<LlmTurnResult> {
  const followUpMessages: ChatMessage[] = [
    ...params.messages,
    {
      role: 'user',
      content:
        `[Tool ${params.toolName}(${JSON.stringify(params.toolArgs)}) returned:\n` +
        `${JSON.stringify(params.toolResult, null, 2)}\n\n` +
        "Continue with the user's original request. " +
        'If they wanted to log production, a purchase, or an order and you now have IDs from this lookup, call the matching write tool. ' +
        'If they wanted to assign work and you now have worker IDs, call assign_work. ' +
        'If nothing matched, say so clearly and mention names from availableInCatalog when present. ' +
        'Do not repeat the same lookup.',
    },
  ]
  return runLlmTurn({
    apiKey: params.apiKey,
    model: params.model,
    messages: followUpMessages,
    role: params.role,
  })
}
