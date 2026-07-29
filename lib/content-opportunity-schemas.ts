import { z } from "zod";

export const CONTENT_OPPORTUNITY_STATUSES = [
  "opportunity",
  "generating",
  "in_production",
  "published",
  "postponed",
  "failed",
] as const;

export const evergreenCandidateAnalysisSchema = z.object({
  candidateKey: z.string().min(2).max(180),
  evergreenPotential: z.boolean(),
  suggestedTitle: z.string().min(10).max(180),
  topic: z.string().min(2).max(120),
  category: z.string().min(2).max(100),
  relatedIcps: z.array(z.string().min(2).max(100)).min(1).max(8),
  rationale: z.string().min(30).max(900),
  transfastRelevance: z.string().min(20).max(600),
  recurrence: z.string().min(10).max(400),
  longevity: z.string().min(10).max(400),
  primaryKeyword: z.string().min(2).max(120),
  searchIntent: z.string().min(5).max(240),
  strategicScore: z.number().int().min(0).max(100),
  priority: z.enum(["high", "good", "secondary", "hidden"]),
  cannibalization: z.enum(["none", "update_existing", "expand_existing", "skip"]),
  recommendation: z.enum(["create", "update", "expand", "skip"]),
});

export const evergreenOpportunityBatchSchema = z.object({
  items: z.array(evergreenCandidateAnalysisSchema).min(1).max(3),
});

export const contentOpportunityActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start_analysis") }),
  z.object({
    action: z.literal("process_job"),
    jobId: z.number().int().positive().optional(),
  }),
  z.object({
    action: z.literal("postpone"),
    opportunityId: z.number().int().positive(),
    reason: z.enum([
      "not_priority",
      "similar_content",
      "low_relevance",
      "produce_later",
      "other",
    ]).nullable().optional(),
  }),
  z.object({
    action: z.literal("restore"),
    opportunityId: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("generate_kit"),
    opportunityId: z.number().int().positive(),
  }),
]);

export type EvergreenOpportunityBatch = z.infer<typeof evergreenOpportunityBatchSchema>;
export type EvergreenCandidateAnalysis = z.infer<typeof evergreenCandidateAnalysisSchema>;
export type ContentOpportunityStatus = typeof CONTENT_OPPORTUNITY_STATUSES[number];
