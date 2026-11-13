/** WebGPU-инференс через WebLLM. Пакет грузится лениво, только по кнопке. */

import type { MLCEngine } from "@mlc-ai/web-llm";

export interface ModelChoice {
  match: string;
  label: string;
  size: string;
  note: string;
}

export const MODELS: ModelChoice[] = [
  {
    match: "Qwen2.5-1.5B-Instruct",
    label: "Qwen2.5 1.5B",
    size: "≈1.1 ГБ",
    note: "лучше держит русский · нужно ~1.6 ГБ видеопамяти",
  },
  {
    match: "Qwen2.5-0.5B-Instruct",
    label: "Qwen2.5 0.5B",
    size: "≈0.4 ГБ",
    note: "быстрее · нужно ~0.9 ГБ видеопамяти",
  },
  {
    match: "Llama-3.2-1B-Instruct",
    label: "Llama 3.2 1B",
    size: "≈0.7 ГБ",
    note: "альтернатива · нужно ~1.1 ГБ видеопамяти",
  },
];

let engine: MLCEngine | null = null;
let loadedModel = "";
let interrupted = false;

export function hasWebGPU(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator && Boolean(navigator.gpu);
}

export async function resolveModelId(match: string): Promise<string | null> {
  const { prebuiltAppConfig } = await import("@mlc-ai/web-llm");
  const found = prebuiltAppConfig.model_list.find((m) =>
    m.model_id.toLowerCase().includes(match.toLowerCase()),
  );
  return found?.model_id ?? null;
}

export interface ProgressReport {
  progress: number;
  text: string;
}

export async function ensureEngine(
  modelId: string,
  onProgress: (p: ProgressReport) => void,
): Promise<MLCEngine> {
  if (engine && loadedModel === modelId) return engine;

  if (engine) {
    try {
      await engine.unload();
    } catch {
      /* не критично */
    }
    engine = null;
    loadedModel = "";
  }

  const { CreateMLCEngine } = await import("@mlc-ai/web-llm");
  engine = await CreateMLCEngine(modelId, {
    initProgressCallback: (report) => {
      onProgress({ progress: report.progress ?? 0, text: report.text ?? "" });
    },
  });
  loadedModel = modelId;
  return engine;
}

export async function generate(
  system: string,
  user: string,
  onToken: (chunk: string) => void,
): Promise<string> {
  if (!engine) throw new Error("Модель ещё не загружена");
  interrupted = false;

  const stream = await engine.chat.completions.create({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.3,
    max_tokens: 900,
    stream: true,
  });

  let text = "";
  for await (const chunk of stream) {
    if (interrupted) break;
    const piece = chunk.choices?.[0]?.delta?.content ?? "";
    if (piece) {
      text += piece;
      onToken(piece);
    }
  }
  return text;
}

export function stopGeneration(): void {
  interrupted = true;
  try {
    engine?.interruptGenerate();
  } catch {
    /* движок мог ещё не начать */
  }
}

export function isReady(modelId: string): boolean {
  return Boolean(engine) && loadedModel === modelId;
}
