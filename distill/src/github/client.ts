import { getGithubToken } from "../config/load";

const GITHUB_GRAPHQL = "https://api.github.com/graphql";

export interface GraphqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export async function githubGraphql<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const token = getGithubToken();
  const res = await fetch(GITHUB_GRAPHQL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "linkrowth-distill",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub GraphQL HTTP ${res.status}: ${text}`);
  }

  const json = (await res.json()) as GraphqlResponse<T>;
  if (json.errors?.length) {
    throw new Error(`GitHub GraphQL: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (!json.data) {
    throw new Error("GitHub GraphQL: empty data");
  }
  return json.data;
}
