"use strict";

// GitHub starts this repo's scheduled workflows hours late: about 3.5 hours in
// October 2026, so the 03:45 news run landed at 07:15 Manila, and three
// briefings in a week were built on the previous morning's news. Google's
// scheduler is on time, so dispatchMorningNews (index.js) asks GitHub to run
// the news job now; a workflow_dispatch starts within a minute or so. The
// GitHub crons stay as catch-ups, and a news run is a no-op once the day's
// snapshot exists (news/refresh-news.js).

const REPO = "bobbynacario-design/bobdailybriefing";
const WORKFLOW = "refresh-intelligence.yml";
// The workflow's own "feed" choices.
const FEEDS = ["radar", "markets", "news", "grounding"];

function dispatchRequest(token, feed) {
  if (!token) throw new Error("GITHUB_DISPATCH_TOKEN is not set");
  if (FEEDS.indexOf(feed) < 0) throw new Error(`Unknown feed "${feed}"`);
  return {
    url: `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    init: {
      method: "POST",
      headers: {
        "accept": "application/vnd.github+json",
        "authorization": `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "bobdailybriefing-dispatch",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify({ref: "main", inputs: {feed}}),
    },
  };
}

// GitHub answers 204 No Content when it accepts a dispatch. Anything else throws,
// so the scheduler retries; the message carries the status and GitHub's own
// words, never the token.
async function dispatchFeed(fetchImpl, token, feed) {
  const {url, init} = dispatchRequest(token, feed);
  const res = await fetchImpl(url, init);
  if (res.status !== 204) {
    let detail = "";
    try {
      detail = String(await res.text()).replace(/\s+/g, " ").slice(0, 200);
    } catch (error) {
      detail = "";
    }
    throw new Error(`GitHub refused the ${feed} dispatch (HTTP ${res.status})${detail ? ": " + detail : ""}`);
  }
  return {feed, status: res.status};
}

module.exports = {REPO, WORKFLOW, FEEDS, dispatchRequest, dispatchFeed};
