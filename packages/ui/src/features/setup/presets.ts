// Provider presets the model step offers (mirrors packages/plugins/providers/presets/*.toml, F72).
export interface PresetChoice {
  id: string;
  label: string;
  base_url: string;
  key_env?: string;
  hint: string;
}

export const PRESETS: PresetChoice[] = [
  { id: "ollama", label: "Ollama (local)", base_url: "http://127.0.0.1:11434/v1", hint: "localhost:11434, no key" },
  { id: "lmstudio", label: "LM Studio (local)", base_url: "http://127.0.0.1:1234/v1", hint: "localhost:1234, no key" },
  { id: "vllm", label: "vLLM", base_url: "http://127.0.0.1:8000/v1", hint: "localhost:8000, key optional" },
  { id: "llamacpp", label: "llama.cpp server", base_url: "http://127.0.0.1:8080/v1", hint: "localhost:8080, no key" },
  { id: "openai", label: "OpenAI", base_url: "https://api.openai.com/v1", key_env: "OPENAI_API_KEY", hint: "key from environment" },
  { id: "openrouter", label: "OpenRouter", base_url: "https://openrouter.ai/api/v1", key_env: "OPENROUTER_API_KEY", hint: "key from environment" },
  { id: "custom", label: "Custom", base_url: "", hint: "any OpenAI-style server" },
];

export const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
export const PROVIDER_ID = /^[A-Za-z0-9._-]+$/;

/** "1, 2 ,3" -> ["1","2","3"] (empty entries dropped). */
export function splitList(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
