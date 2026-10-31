import { z } from "zod";
import { badRequest } from "./errors";

export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the YYYY-MM-DD date format")
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00`).getTime()), "Invalid date");
export const monthString = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use the YYYY-MM month format");
export const idParam = z.coerce.number().int().positive();

/** Trim text and turn empty strings into undefined. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

/** Validate input with a zod schema and throw a 400 with field errors when it fails. */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message }));
    throw badRequest(fields[0]?.message ?? "Invalid input", fields);
  }
  return result.data;
}
