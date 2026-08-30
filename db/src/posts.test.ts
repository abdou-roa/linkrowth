import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { upsertPost, type QueryClient } from "./posts";

describe("upsertPost", () => {
  it("serializes JSON and normalizes a valid extraction timestamp", async () => {
    let values: unknown[] | undefined;
    const client = {
      query: async (_sql: string, queryValues?: unknown[]) => {
        values = queryValues;
        return { rows: [], rowCount: 0 };
      },
    } as unknown as QueryClient;

    await upsertPost(client, {
      id: "post-1",
      text: "Post",
      comments: [{ author: "Ada", text: "Useful", likes: 2 }],
      extractedAt: "2026-08-28T12:00:00Z",
    });

    assert.equal(
      values?.[9],
      JSON.stringify([{ author: "Ada", text: "Useful", likes: 2 }])
    );
    assert.equal(values?.[11], "2026-08-28T12:00:00.000Z");
  });

  it("stores invalid extraction timestamps as null", async () => {
    let values: unknown[] | undefined;
    const client = {
      query: async (_sql: string, queryValues?: unknown[]) => {
        values = queryValues;
        return { rows: [], rowCount: 0 };
      },
    } as unknown as QueryClient;

    await upsertPost(client, {
      id: "post-2",
      text: "Post",
      extractedAt: "not-a-date",
    });

    assert.equal(values?.[9], "[]");
    assert.equal(values?.[11], null);
  });
});
