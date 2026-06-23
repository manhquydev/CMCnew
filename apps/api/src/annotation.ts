import { z } from 'zod';

// Annotation layer = the marks a principal draws over the exercise base PDF, stored as a JSON
// data layer (spec §3) — NOT a flattened PDF. Coordinates are NORMALISED to the page box (0..1),
// so a layer renders correctly at any zoom/DPR and is independent of render width.
//
// This is the single source of truth for the layer shape: the API validates writes against the
// zod schema, and the UI imports the TS type (type-only) to author/render. Caps bound the payload
// (spec §3 "cap payload annotation") so one submission can't store an unbounded blob.

const MAX_ITEMS = 500;
const MAX_INK_POINTS = 2000;
const MAX_TEXT_LEN = 500;

const point = z.object({ x: z.number(), y: z.number() });
const color = z.string().max(32); // e.g. "#e03131" / "rgba(...)"; bounded, never rendered as HTML.

const inkItem = z.object({
  type: z.literal('ink'),
  page: z.number().int().min(0),
  color,
  width: z.number().min(0.1).max(40),
  points: z.array(point).min(1).max(MAX_INK_POINTS),
});

const textItem = z.object({
  type: z.literal('text'),
  page: z.number().int().min(0),
  color,
  size: z.number().min(4).max(200),
  pos: point,
  text: z.string().min(1).max(MAX_TEXT_LEN),
});

const highlightItem = z.object({
  type: z.literal('highlight'),
  page: z.number().int().min(0),
  color,
  rect: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
});

export const annotationItemSchema = z.discriminatedUnion('type', [inkItem, textItem, highlightItem]);

export const annotationDataSchema = z.object({
  v: z.literal(1),
  items: z.array(annotationItemSchema).max(MAX_ITEMS),
});

export type AnnotationItem = z.infer<typeof annotationItemSchema>;
export type AnnotationData = z.infer<typeof annotationDataSchema>;
