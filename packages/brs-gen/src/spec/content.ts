import { z } from 'zod';

/**
 * Optional content block. Only Roku Direct Publisher JSON is supported in
 * v0.4.0; MRSS / sitemap-rss would extend the enum in a later plan.
 */
export const ContentSchema = z
  .object({
    feed_url: z.string().url(),
    feed_format: z.enum(['roku_direct_publisher_json']),
  })
  .strict();

export type Content = z.infer<typeof ContentSchema>;
