/**
 * Tool schema helpers for provider adapters.
 * Keeps parsing and provider-specific schema adaptation centralized.
 */

const DEFAULT_SCHEMA = { type: 'object', properties: {} };

const GEMINI_TYPE_MAP = {
  object: 'OBJECT',
  array: 'ARRAY',
  string: 'STRING',
  number: 'NUMBER',
  integer: 'INTEGER',
  boolean: 'BOOLEAN'
};

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function parseToolInputSchema(rawSchema) {
  if (!rawSchema) {
    return { ...DEFAULT_SCHEMA };
  }

  if (typeof rawSchema === 'string') {
    try {
      const parsed = JSON.parse(rawSchema);
      return isPlainObject(parsed) ? parsed : { ...DEFAULT_SCHEMA };
    } catch {
      return { ...DEFAULT_SCHEMA };
    }
  }

  if (isPlainObject(rawSchema)) {
    return rawSchema;
  }

  return { ...DEFAULT_SCHEMA };
}

function pickNonNullType(schemaType) {
  if (typeof schemaType === 'string') {
    return schemaType.toLowerCase();
  }

  if (Array.isArray(schemaType)) {
    const nonNull = schemaType.find((entry) => typeof entry === 'string' && entry.toLowerCase() !== 'null');
    return nonNull ? nonNull.toLowerCase() : null;
  }

  return null;
}

function inferType(schema) {
  const explicit = pickNonNullType(schema.type);
  if (explicit) return explicit;
  if (isPlainObject(schema.properties)) return 'object';
  if (schema.items) return 'array';
  return 'object';
}

function normalizeGeminiSchema(schema) {
  const parsed = parseToolInputSchema(schema);
  const schemaType = inferType(parsed);
  const geminiType = GEMINI_TYPE_MAP[schemaType] || 'OBJECT';
  const out = { type: geminiType };

  if (typeof parsed.description === 'string' && parsed.description.trim()) {
    out.description = parsed.description.trim();
  }

  if (Array.isArray(parsed.enum) && parsed.enum.length > 0) {
    const filtered = parsed.enum.filter(
      (value) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    );
    if (filtered.length > 0) {
      out.enum = filtered;
    }
  }

  if (schemaType === 'object') {
    const properties = isPlainObject(parsed.properties) ? parsed.properties : {};
    const nextProperties = {};
    for (const [key, child] of Object.entries(properties)) {
      nextProperties[key] = normalizeGeminiSchema(child);
    }
    out.properties = nextProperties;

    if (Array.isArray(parsed.required)) {
      out.required = parsed.required.filter((value) => typeof value === 'string');
    }
  }

  if (schemaType === 'array') {
    out.items = normalizeGeminiSchema(parsed.items || {});
  }

  return out;
}

export function toGeminiSchema(rawSchema) {
  return normalizeGeminiSchema(rawSchema);
}
