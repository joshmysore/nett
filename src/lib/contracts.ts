import { z } from "zod";

/** Closed set of fields capture extraction may propose. */
export const CaptureFieldSchema = z.enum([
  "location",
  "hometown",
  "industry",
  "company",
  "languages",
  "relationship",
  "how_met",
  "where_met",
  "when_met",
  "mutuals",
  "interests",
  "tags",
  "follow_up_date",
]);
export type CaptureField = z.infer<typeof CaptureFieldSchema>;

export const CaptureProposalSchema = z.object({
  field: CaptureFieldSchema,
  value: z.string(),
  values: z.array(z.string()).optional(),
  evidence: z.string(),
  evidenceStart: z.number().int().nonnegative(),
  evidenceEnd: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
});
export type CaptureProposal = z.infer<typeof CaptureProposalSchema>;

export const SuggestionEvidenceSchema = z.object({
  sourceType: z.string(),
  sourceId: z.string().optional(),
  excerpt: z.string().optional(),
  quote: z.string().optional(),
  observedAt: z.string().optional(),
});
export type SuggestionEvidence = z.infer<typeof SuggestionEvidenceSchema>;

export const AutofillSuggestionSchema = z.object({
  id: z.string().optional(),
  field: z.string(),
  value: z.unknown(),
  normalizedValue: z.unknown().optional(),
  confidence: z.number(),
  reason: z.string(),
  source: z.string(),
  operation: z.enum(["set", "append", "clear"]).optional(),
  conflict: z.boolean().optional(),
  existingValue: z.unknown().optional(),
  evidence: z.array(SuggestionEvidenceSchema).optional(),
  evidenceIds: z.array(z.string()).optional(),
});
export type AutofillSuggestion = z.infer<typeof AutofillSuggestionSchema>;

export const RelationshipModeSchema = z.enum(["personal", "business", "mixed"]);
export type RelationshipMode = z.infer<typeof RelationshipModeSchema>;

export const InsightSuggestionSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(["field", "tag", "follow_up", "strategy", "mode"]),
  field: z.string().optional(),
  value: z.unknown(),
  confidence: z.number(),
  reason: z.string(),
  evidence: z.array(z.string()),
  mode: RelationshipModeSchema.optional(),
});
export type InsightSuggestion = z.infer<typeof InsightSuggestionSchema>;

export const RelationshipInsightSchema = z.object({
  personId: z.string(),
  generatedAt: z.string(),
  provider: z.string(),
  degraded: z.boolean(),
  note: z.string().optional(),
  briefing: z.string(),
  pattern: z.object({
    recency: z.number(),
    cadenceDrift: z.number(),
    reciprocity: z.number(),
    channelDiversity: z.number(),
    interactionFrequency: z.number(),
    interactions: z.number(),
    channels: z.array(z.string()),
    daysSinceContact: z.number(),
    typicalCadenceDays: z.number(),
    incoming: z.number(),
    outgoing: z.number(),
  }),
  themes: z.array(z.object({
    label: z.string(),
    evidence: z.array(z.string()),
  })),
  mode: RelationshipModeSchema.nullable(),
  suggestions: z.array(InsightSuggestionSchema),
});
export type RelationshipInsight = z.infer<typeof RelationshipInsightSchema>;

export const GeoOptionSchema = z.object({
  code: z.string(),
  name: z.string(),
});
export type GeoOption = z.infer<typeof GeoOptionSchema>;

export const FacetSchema = z.object({
  value: z.string(),
  count: z.number(),
});
export type Facet = z.infer<typeof FacetSchema>;

export const PublicProfileSuggestionSchema = z.object({
  field: z.enum([
    "linkedin_url",
    "headline",
    "job_title",
    "company",
    "location",
    "institutions",
    "hometown",
  ]),
  value: z.union([z.string(), z.array(z.string())]),
  confidence: z.number(),
  reason: z.string(),
  evidence: z.string(),
  source: z.literal("linkedin-public"),
});
export type PublicProfileSuggestion = z.infer<typeof PublicProfileSuggestionSchema>;

/** Patch body accepted by PATCH /api/people/:id. */
export const PersonPatchSchema = z.object({
  name: z.string().optional(),
  hometown: z.union([z.string(), z.array(z.string())]).optional(),
  location: z.string().optional(),
  industry: z.string().optional(),
  company: z.string().optional(),
  spike: z.string().optional(),
  languages: z.union([z.string(), z.array(z.string())]).optional(),
  skills: z.union([z.string(), z.array(z.string())]).optional(),
  interests: z.union([z.string(), z.array(z.string())]).optional(),
  foods: z.union([z.string(), z.array(z.string())]).optional(),
  gender: z.string().optional(),
  culture: z.string().optional(),
  personality: z.string().optional(),
  online_personality: z.union([z.string(), z.array(z.string())]).optional(),
  birthday: z.string().optional(),
  relationship_strength: z.union([z.number(), z.string()]).optional(),
  relationship: z.string().optional(),
  when_met: z.string().optional(),
  where_met: z.string().optional(),
  how_met: z.string().optional(),
  institutions: z.union([z.string(), z.array(z.string())]).optional(),
  mutuals: z.union([z.string(), z.array(z.string())]).optional(),
  last_contact: z.string().optional(),
  notes: z.string().optional(),
  quick_memories: z.string().optional(),
  follow_up_date: z.string().optional(),
  priority: z.union([z.number(), z.string()]).optional(),
  warmth: z.union([z.number(), z.string()]).optional(),
  intro_potential: z.union([z.number(), z.string()]).optional(),
  source_confidence: z.union([z.number(), z.string()]).optional(),
  linkedin_url: z.string().optional(),
  headline: z.string().optional(),
  job_title: z.string().optional(),
  tags: z.array(z.string()).optional(),
}).passthrough();
export type PersonPatch = z.infer<typeof PersonPatchSchema>;

export function parsePersonPatch(input: unknown): PersonPatch {
  return PersonPatchSchema.parse(input);
}
