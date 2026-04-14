/**
 * Minimal Zod -> JSON Schema adapter. Enough for our tool inputs (objects of
 * primitives, enums, arrays). Keeps us off the `zod-to-json-schema` dep.
 */

import { z, type ZodTypeAny } from "zod";

export function zodToJsonSchema(schema: ZodTypeAny): any {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, ZodTypeAny>;
    const props: Record<string, any> = {};
    const required: string[] = [];
    for (const [k, v] of Object.entries(shape)) {
      props[k] = zodToJsonSchema(v);
      if (!(v instanceof z.ZodOptional) && !(v instanceof z.ZodDefault)) required.push(k);
    }
    return { type: "object", properties: props, required, additionalProperties: false };
  }
  if (schema instanceof z.ZodString) {
    const desc = (schema as any)._def.description;
    const out: any = { type: "string" };
    if (desc) out.description = desc;
    for (const c of (schema as any)._def.checks ?? []) {
      if (c.kind === "url") out.format = "uri";
      if (c.kind === "min") out.minLength = c.value;
    }
    return out;
  }
  if (schema instanceof z.ZodNumber) {
    const out: any = { type: "number" };
    for (const c of (schema as any)._def.checks ?? []) {
      if (c.kind === "int") out.type = "integer";
      if (c.kind === "min") out.minimum = c.value;
      if (c.kind === "max") out.maximum = c.value;
    }
    return out;
  }
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };
  if (schema instanceof z.ZodArray) return { type: "array", items: zodToJsonSchema((schema as any)._def.type) };
  if (schema instanceof z.ZodEnum) return { type: "string", enum: (schema as any)._def.values };
  if (schema instanceof z.ZodOptional) return zodToJsonSchema((schema as any)._def.innerType);
  if (schema instanceof z.ZodDefault) {
    const inner = zodToJsonSchema((schema as any)._def.innerType);
    inner.default = (schema as any)._def.defaultValue();
    return inner;
  }
  if (schema instanceof z.ZodUnion) {
    return { anyOf: (schema as any)._def.options.map(zodToJsonSchema) };
  }
  return {};
}
