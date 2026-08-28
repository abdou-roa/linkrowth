import type { PoolClient } from "pg";
import type { PostInput } from "./types";

export type QueryClient = Pick<PoolClient, "query">;

export async function upsertPost(
  client: QueryClient,
  post: PostInput
): Promise<void> {
  const extractedAt = post.extractedAt ? new Date(post.extractedAt) : null;

  await client.query(
    `INSERT INTO posts (
       id, url, text,
       author_name, author_headline, author_profile_url, author_username,
       likes, comments_count, comments, age_text, extracted_at, updated_at
     ) VALUES (
       $1, $2, $3,
       $4, $5, $6, $7,
       $8, $9, $10::jsonb, $11, $12, NOW()
     )
     ON CONFLICT (id) DO UPDATE SET
       url = EXCLUDED.url,
       text = EXCLUDED.text,
       author_name = EXCLUDED.author_name,
       author_headline = EXCLUDED.author_headline,
       author_profile_url = EXCLUDED.author_profile_url,
       author_username = EXCLUDED.author_username,
       likes = EXCLUDED.likes,
       comments_count = EXCLUDED.comments_count,
       comments = EXCLUDED.comments,
       age_text = EXCLUDED.age_text,
       extracted_at = EXCLUDED.extracted_at,
       updated_at = NOW()`,
    [
      post.id,
      post.url ?? null,
      post.text,
      post.author?.name ?? null,
      post.author?.headline ?? null,
      post.author?.profileUrl ?? null,
      post.author?.username ?? null,
      post.metrics?.likes ?? null,
      post.metrics?.commentsCount ?? null,
      JSON.stringify(post.comments ?? []),
      post.ageText ?? null,
      extractedAt && !Number.isNaN(extractedAt.getTime())
        ? extractedAt.toISOString()
        : null,
    ]
  );
}
