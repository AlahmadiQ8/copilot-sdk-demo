import { CosmosClient, Container, Database } from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";
import { cosmosErrorCounter, cosmosDurationHistogram, log } from "./telemetry.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface Conversation {
  id: string;
  conversationId: string; // partition key (same as id)
  title: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  ttl?: number;
}

// ---------------------------------------------------------------------------
// Cosmos DB Store
// ---------------------------------------------------------------------------
let container: Container | null = null;
let database: Database | null = null;

const COSMOS_ENDPOINT = process.env.COSMOS_ENDPOINT;
const COSMOS_DATABASE = process.env.COSMOS_DATABASE || "conversations";
const CONVERSATION_TTL = 86400; // 24 hours

function isConfigured(): boolean {
  return !!COSMOS_ENDPOINT;
}

export function getStoreStatus(): { configured: boolean; endpoint: string | undefined; database: string } {
  return { configured: isConfigured(), endpoint: COSMOS_ENDPOINT, database: COSMOS_DATABASE };
}

async function getContainer(): Promise<Container> {
  if (container) return container;
  if (!COSMOS_ENDPOINT) {
    throw new Error("COSMOS_ENDPOINT is not set — conversation store unavailable");
  }
  const credential = new DefaultAzureCredential();
  const client = new CosmosClient({ endpoint: COSMOS_ENDPOINT, aadCredentials: credential });
  database = client.database(COSMOS_DATABASE);
  container = database.container("messages");
  log("info", "Cosmos DB store initialized", { endpoint: COSMOS_ENDPOINT, database: COSMOS_DATABASE });
  return container;
}

async function timedOp<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    cosmosDurationHistogram.record(Date.now() - start, { operation });
    return result;
  } catch (err) {
    cosmosDurationHistogram.record(Date.now() - start, { operation });
    cosmosErrorCounter.add(1, { operation });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// CRUD Operations
// ---------------------------------------------------------------------------

export async function createConversation(title: string): Promise<Conversation> {
  const c = await getContainer();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const conversation: Conversation = {
    id,
    conversationId: id,
    title,
    messages: [],
    createdAt: now,
    updatedAt: now,
    ttl: CONVERSATION_TTL,
  };
  await timedOp("create", () => c.items.create(conversation));
  return conversation;
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const c = await getContainer();
  try {
    const { resource } = await timedOp("read", () => c.item(id, id).read<Conversation>());
    return resource ?? null;
  } catch (err: unknown) {
    if ((err as { code?: number }).code === 404) return null;
    throw err;
  }
}

export async function deleteConversation(id: string): Promise<boolean> {
  const c = await getContainer();
  try {
    await timedOp("delete", () => c.item(id, id).delete());
    return true;
  } catch (err: unknown) {
    if ((err as { code?: number }).code === 404) return false;
    throw err;
  }
}

export async function listConversations(limit = 20, offset = 0): Promise<{ conversations: Conversation[]; count: number }> {
  const c = await getContainer();
  const countResult = await timedOp("count", () =>
    c.items.query("SELECT VALUE COUNT(1) FROM c").fetchAll()
  );
  const count = countResult.resources[0] ?? 0;

  const { resources } = await timedOp("list", () =>
    c.items
      .query({
        query: "SELECT c.id, c.title, c.createdAt, c.updatedAt FROM c ORDER BY c.updatedAt DESC OFFSET @offset LIMIT @limit",
        parameters: [
          { name: "@offset", value: offset },
          { name: "@limit", value: limit },
        ],
      })
      .fetchAll()
  );
  return { conversations: resources, count };
}

export async function addMessage(id: string, role: "user" | "assistant", content: string): Promise<Conversation | null> {
  const conversation = await getConversation(id);
  if (!conversation) return null;

  const message: Message = { role, content, timestamp: new Date().toISOString() };
  conversation.messages.push(message);
  conversation.updatedAt = new Date().toISOString();
  conversation.ttl = CONVERSATION_TTL; // reset TTL on activity

  const c = await getContainer();
  await timedOp("update", () => c.item(id, id).replace(conversation));
  return conversation;
}
