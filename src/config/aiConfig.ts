export interface AIConfiguration {
  apiKey?: string;
  model: string;
  isConfigured: boolean;
  maxMessageLength: number;
}

const DEFAULT_MODEL = 'gemini-3.8-flash';
const MAX_MESSAGE_LENGTH = 1000;

export const getGeminiApiKey = (): string | undefined => {
  const key = process.env.GEMINI_API_KEY;
  if (!key || typeof key !== 'string' || key.trim() === '') {
    return undefined;
  }
  return key.trim();
};

export const getGeminiModel = (): string => {
  const model = process.env.GEMINI_MODEL;
  if (!model || typeof model !== 'string' || model.trim() === '') {
    return DEFAULT_MODEL;
  }
  return model.trim();
};

export const isGeminiConfigured = (): boolean => {
  return Boolean(getGeminiApiKey());
};

export const getAIConfig = (): AIConfiguration => {
  const apiKey = getGeminiApiKey();
  return {
    apiKey,
    model: getGeminiModel(),
    isConfigured: Boolean(apiKey),
    maxMessageLength: MAX_MESSAGE_LENGTH,
  };
};

/**
 * Returns a masked representation of the API key for safe debugging.
 * Never outputs the full key.
 */
export const getMaskedApiKey = (key?: string): string => {
  const targetKey = key || getGeminiApiKey();
  if (!targetKey) return '[NO_KEY_CONFIGURED]';
  if (targetKey.length <= 8) return '****';
  return `${targetKey.slice(0, 4)}...${targetKey.slice(-4)}`;
};
