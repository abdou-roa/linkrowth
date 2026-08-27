/** Paginated merged-PR hierarchy: files summary + discussion, no diff hunks. */
export const MERGED_PRS_QUERY = `
query MergedPrs($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    nameWithOwner
    pullRequests(
      states: MERGED
      first: 20
      after: $cursor
      orderBy: { field: UPDATED_AT, direction: DESC }
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        number
        title
        body
        mergedAt
        createdAt
        author {
          __typename
          login
        }
        files(first: 100) {
          nodes {
            path
            additions
            deletions
          }
        }
        comments(first: 50) {
          nodes {
            author { login }
            body
          }
        }
        reviews(first: 30) {
          nodes {
            author { login }
            state
            body
            comments(first: 50) {
              nodes {
                author { login }
                body
                path
              }
            }
          }
        }
      }
    }
  }
}
`;
