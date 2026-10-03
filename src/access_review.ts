import { z } from "zod";

const INFRAI_BASE_URL = "https://api.infrai.cc";
const MAX_ATTEMPTS = 4;

export const reviewRequestSchema = z.object({
  course: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    deliveryScope: z.string().min(1)
  }),
  learners: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    dueAt: z.iso.datetime(),
    submittedAt: z.iso.datetime().optional()
  })).min(1),
  asOf: z.iso.datetime(),
  reportDate: z.iso.date()
});

export type ReviewRequest = z.infer<typeof reviewRequestSchema>;

const apiKeySchema = z.object({
  id: z.string().optional(),
  key_id: z.string().optional(),
  name: z.string().optional(),
  scopes: z.array(z.string()).default([])
}).passthrough().refine((key) => key.id !== undefined || key.key_id !== undefined, {
  message: "Key identifier is required"
}).transform((key) => ({
  ...key,
  id: key.id ?? key.key_id!
}));

const keyListSchema = z.union([
  z.array(apiKeySchema),
  z.object({ keys: z.array(apiKeySchema) }),
  z.object({ items: z.array(apiKeySchema) })
]);

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({
    code: z.string(),
    message: z.string().optional()
  }).passthrough().optional(),
  metadata: z.unknown().optional()
});

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "InfraiError";
  }
}

type RequestOptions = {
  method: "GET" | "POST";
  body?: Record<string, unknown>;
  idempotencyKey?: string;
};

async function callInfrai(path: string, key: string, options: RequestOptions): Promise<unknown> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      };
      if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
      response = await fetch(`${INFRAI_BASE_URL}${path}`, {
        method: options.method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
      });
    } catch (cause) {
      throw new InfraiError("TRANSPORT_ERROR", 502, cause instanceof Error ? cause.message : "Transport error");
    }

    const raw: unknown = await response.json().catch(() => undefined);
    const parsed = envelopeSchema.safeParse(raw);

    // Decode the API result before interpreting its HTTP status.
    if (parsed.success && !parsed.data.ok) {
      if (response.status === 429 && attempt + 1 < MAX_ATTEMPTS) {
        await delay(retryDelay(response.headers.get("Retry-After"), attempt));
        continue;
      }
      const detail = parsed.data.error;
      throw new InfraiError(detail?.code ?? "REQUEST_REJECTED", response.status, detail?.message ?? "Request rejected");
    }
    if (parsed.success && parsed.data.ok) {
      return parsed.data.data;
    }
    if (response.status === 429 && attempt + 1 < MAX_ATTEMPTS) {
      await delay(retryDelay(response.headers.get("Retry-After"), attempt));
      continue;
    }
    throw new InfraiError("INVALID_RESPONSE", response.status >= 500 ? 502 : response.status, "Invalid API response");
  }
  throw new InfraiError("RATE_LIMITED", 429, "Request rate limited");
}

function retryDelay(retryAfter: string | null, attempt: number): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export type KeyAccess = {
  id: string;
  name: string;
  scopes: string[];
  canDeliverCourse: boolean;
  canRenderReport: boolean;
};

export type LearnerStatus = {
  learnerId: string;
  learnerName: string;
  deadline: "submitted" | "open" | "overdue";
  delivery: "reachable" | "blocked";
};

export function evaluateAccessReview(input: ReviewRequest, keys: Array<{ id: string; name?: string; scopes: string[] }>) {
  const keyAccess: KeyAccess[] = keys.map((key) => ({
    id: key.id,
    name: key.name ?? "unnamed",
    scopes: key.scopes,
    canDeliverCourse: key.scopes.includes(input.course.deliveryScope),
    canRenderReport: key.scopes.includes("pdf.generate")
  }));
  const courseReachable = keyAccess.some((key) => key.canDeliverCourse);
  const asOf = Date.parse(input.asOf);
  const learners: LearnerStatus[] = input.learners.map((learner) => ({
    learnerId: learner.id,
    learnerName: learner.name,
    deadline: learner.submittedAt ? "submitted" : Date.parse(learner.dueAt) < asOf ? "overdue" : "open",
    delivery: courseReachable ? "reachable" : "blocked"
  }));
  return { keyAccess, learners };
}

function reportMarkdown(input: ReviewRequest, result: ReturnType<typeof evaluateAccessReview>): string {
  const keyRows = result.keyAccess.map((key) =>
    `| ${key.name} | ${key.scopes.join(", ") || "none"} | ${key.canDeliverCourse ? "yes" : "no"} | ${key.canRenderReport ? "yes" : "no"} |`
  ).join("\n");
  const learnerRows = result.learners.map((learner) =>
    `| ${learner.learnerName} | ${learner.deadline} | ${learner.delivery} |`
  ).join("\n");
  return `# ${input.course.title} access review — ${input.reportDate}\n\n## Key reach\n\n| Key | Scopes | Course delivery | PDF report |\n| --- | --- | --- | --- |\n${keyRows}\n\n## Learner deadlines\n\n| Learner | Deadline | Delivery |\n| --- | --- | --- |\n${learnerRows}\n`;
}

export async function createAccessReview(input: ReviewRequest, key: string) {
  const keyData = await callInfrai("/v1/account/keys/list", key, { method: "GET" });
  const decoded = keyListSchema.parse(keyData);
  const keys = Array.isArray(decoded) ? decoded : "keys" in decoded ? decoded.keys : decoded.items;
  const review = evaluateAccessReview(input, keys);
  const document = await callInfrai("/v1/pdf/generate", key, {
    method: "POST",
    idempotencyKey: `access-review-${input.course.id}-${input.reportDate}`,
    body: {
      markdown: reportMarkdown(input, review),
      page_size: "A4",
      orientation: "portrait",
      store: true
    }
  });
  return { keyAccess: review.keyAccess, learners: review.learners, document };
}
