/**
 * The JSON answers asked of the light model, defined once: the prompt's "Answer with JSON only" line is made from the
 * definition and the answer is read against it, so the two can't drift apart. Decision fields are strict (a choice
 * between fixed values, a boolean, a number); free-text fields stay free text, cut at a length limit.
 */
export type AnswerField =
  | { readonly kind: "choice"; readonly values: readonly string[]; readonly shown?: readonly string[]; readonly fallback?: string; readonly optional?: boolean }
  | { readonly kind: "text"; readonly hint?: string; readonly max?: number; readonly optional?: boolean }
  | { readonly kind: "boolean"; readonly fallback?: boolean; readonly optional?: boolean }
  | { readonly kind: "number"; readonly nullable?: boolean; readonly optional?: boolean }
  | { readonly kind: "list"; readonly item: AnswerField | AnswerSpec; readonly optional?: boolean };

export type AnswerSpec = { readonly [field: string]: AnswerField };

/**
 * `problems` lists decision fields that had a wrong value and took their fallback: the rest of the answer, its free
 * text included, is still used, and the problems are reported so they can be logged.
 */
export type ReadAnswer =
  | { readonly ok: true; readonly value: Record<string, unknown>; readonly problems: readonly string[] }
  | { readonly ok: false; readonly problem: string };

const DEFAULT_MAX = 500;

const isField = (item: AnswerField | AnswerSpec): item is AnswerField => typeof (item as AnswerField).kind === "string";

function fieldShape(field: AnswerField): string {
  switch (field.kind) {
    case "choice": return (field.shown ?? field.values).map((v) => `"${v}"`).join(" | ");
    case "text": return `"<${field.hint ?? "text"}>"`;
    case "boolean": return "true | false";
    case "number": return field.nullable ? "<number> | null" : "<number>";
    case "list": return `[${isField(field.item) ? fieldShape(field.item) : objectShape(field.item)}, ...]`;
  }
}

const objectShape = (spec: AnswerSpec) => `{${Object.entries(spec).map(([name, field]) => `"${name}": ${fieldShape(field)}`).join(", ")}}`;

/** The JSON the prompt asks for, e.g. {"verdict": "notify" | "wait", "reason": "<one short sentence>"}. */
export const answerShape = (spec: AnswerSpec): string => objectShape(spec);

class Invalid extends Error {}

function readField(path: string, field: AnswerField, value: unknown, problems: string[]): unknown {
  switch (field.kind) {
    case "choice":
      if (typeof value !== "string" || !field.values.includes(value)) throw new Invalid(`${path}: ${JSON.stringify(value)} is not one of ${field.values.join(", ")}`);
      return value;
    case "text": {
      if (typeof value !== "string") throw new Invalid(`${path}: not text`);
      const text = value.trim();
      if (!text) throw new Invalid(`${path}: empty`);
      const max = field.max ?? DEFAULT_MAX;
      return text.length > max ? `${text.slice(0, max - 1)}…` : text;
    }
    case "boolean":
      if (typeof value !== "boolean") throw new Invalid(`${path}: not true or false`);
      return value;
    case "number":
      if (value === null && field.nullable) return null;
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Invalid(`${path}: not a number`);
      return value;
    case "list":
      if (!Array.isArray(value)) throw new Invalid(`${path}: not a list`);
      return value.map((item, i) => (isField(field.item) ? readField(`${path}[${i}]`, field.item, item, problems) : readObject(`${path}[${i}].`, field.item, item, problems)));
  }
}

function readObject(prefix: string, spec: AnswerSpec, value: unknown, problems: string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Invalid(`${prefix || "answer"}: not an object`);
  const object = value as Record<string, unknown>;
  const read: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(spec)) {
    const present = object[name] !== undefined && !(field.kind === "text" && field.optional && typeof object[name] === "string" && !(object[name] as string).trim());
    if (!present) {
      if (field.optional) continue;
      throw new Invalid(`${prefix}${name}: missing`);
    }
    try {
      read[name] = readField(`${prefix}${name}`, field, object[name], problems);
    } catch (err) {
      if (!(err instanceof Invalid) || !("fallback" in field) || field.fallback === undefined) throw err;
      problems.push(`${err.message}; used ${JSON.stringify(field.fallback)}`);
      read[name] = field.fallback;
    }
  }
  return read;
}

/** Reads the model's answer against the definition: the first JSON object in it, fields it doesn't define ignored. */
export function readAnswer(spec: AnswerSpec, text: string): ReadAnswer {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return { ok: false, problem: "no JSON object in the answer" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { ok: false, problem: "the JSON in the answer doesn't parse" };
  }
  const problems: string[] = [];
  try {
    return { ok: true, value: readObject("", spec, parsed, problems), problems };
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, problem: err.message };
    throw err;
  }
}
