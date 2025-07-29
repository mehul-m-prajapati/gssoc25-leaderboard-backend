const fs = require("fs");
const axios = require("axios");
require("dotenv").config();

// CONFIGURATION
const LABELS = [
  { label: "level1", points: 5 },
  { label: "level2", points: 7 },
  { label: "level3", points: 10 },
];
const POSTMAN_BONUS = 500;
const IDENTIFYING_LABELS = ["gssoc25", "GSSoC'25", "gssoc"];
const DATE_RANGE = "closed:2025-07-15..2025-10-20";
const API_URL = "https://api.github.com/search/issues";
//const PROJECTS_URL = "https://opensheet.elk.sh/1JiqHjGyf43NNkou4PBe7WT4KEyueuFJct2p322nNMNw/JSON";

const PROJECTS_URL = "./projects.json";

const GITHUB_TOKEN = process.env.GIT_TOKEN;

const timer = (ms) => new Promise((res) => setTimeout(res, ms));

let leaderboard = {};

function formatRepoPath(repoUrl) {
  const parts = repoUrl.split("/");
  return `${parts[3]}/${parts[4] ?? ""}`;
}

// Utility: Normalize label strings (remove spaces, hyphens, lowercase)
function normalizeLabel(label) {
  return label.toLowerCase().replace(/[\s\-]/g, "");
}

function getLabelScore(labelName) {
  const normalizedInput = normalizeLabel(labelName);
  const found = LABELS.find((l) => l.label === normalizedInput);
  return found ? found.points : 0;
}

function buildSearchQuery(repo) {
  const labelsQuery = IDENTIFYING_LABELS.map((l) => `label:${l}`).join(",");
  return `repo:${repo}+is:pr+${labelsQuery}+is:merged+${DATE_RANGE}`;
}

async function fetchPaginatedPRs(repo, totalCount) {
  const pages = Math.ceil(totalCount / 100);
  let allItems = [];

  for (let page = 2; page <= pages; page++) {
    console.log(`Fetching page ${page}/${pages}`);
    try {
      const res = await axios.get(`${API_URL}?q=${buildSearchQuery(repo)}&per_page=100&page=${page}`, {
        headers: { Authorization: `token ${GITHUB_TOKEN}` },
      });

      if (res.data.items) {
        allItems.push(...res.data.items);
      }
    } catch (err) {
      console.error(`Failed to fetch page ${page}:`, err.message);
    }
    await timer(10000);
  }

  return allItems;
}

function updateLeaderboardFromPRs(prs) {
  for (const pr of prs) {
    const user = pr.user;
    const userId = user.id;

    if (!leaderboard[userId]) {
      leaderboard[userId] = {
        avatar_url: user.avatar_url,
        login: user.login,
        url: user.html_url,
        score: 0,
        pr_urls: new Set(),
        postManTag: false,
      };
    }

    for (const label of pr.labels) {
      const name = label.name.toLowerCase();

      if (name === "postman" && !leaderboard[userId].postManTag) {
        leaderboard[userId].postManTag = true;
        leaderboard[userId].score += POSTMAN_BONUS;
      }

      leaderboard[userId].score += getLabelScore(name);
    }

    leaderboard[userId].pr_urls.add(pr.html_url);
  }
}

async function fetchPRsForProject(repo) {
  try {
    const res = await axios.get(`${API_URL}?q=${buildSearchQuery(repo)}&per_page=100`, {
      headers: { Authorization: `token ${GITHUB_TOKEN}` },
    });

    if (res.data.items && res.data.items.length > 0) {
      const initialPRs = res.data.items;
      updateLeaderboardFromPRs(initialPRs);

      if (res.data.total_count > 100) {
        const paginatedPRs = await fetchPaginatedPRs(repo, res.data.total_count);
        updateLeaderboardFromPRs(paginatedPRs);
      }
    }
  } catch (err) {
    console.warn(`PRs not found for repo: ${repo}`);
  }
}

function exportLeaderboard() {
  const leaderboardArray = Object.values(leaderboard).map((user) => ({
    ...user,
    pr_urls: Array.from(user.pr_urls),
  }));

  leaderboardArray.sort((a, b) => b.score - a.score);

  const data = {
    leaderboard: leaderboardArray,
    success: true,
    updatedAt: Date.now(),
    generated: true,
    updatedTimestring:
      new Date().toLocaleString() +
      " — No new PRs merged after 20th Oct 2025 11:59 p.m will be counted",
  };

  fs.writeFile("leaderboard.json", JSON.stringify(data, null, 2), "utf8", (err) => {
    if (err) throw err;
    console.log("✅ leaderboard.json was updated");
  });
}

async function generateLeaderboard() {
  console.log("🔄 Generating leaderboard...");

  try {
    //const { data: projects } = await axios.get(PROJECTS_URL);


    const read_file = fs.readFileSync(PROJECTS_URL, "utf8");
    const projects = JSON.parse(read_file);

    for (let i = 0; i < projects.length; i++) {
      const rawLink = projects[i].project_link;
      const repo = formatRepoPath(rawLink);

      console.log(`Processing ${repo} (${i + 1}/${projects.length})`);
      await fetchPRsForProject(repo);
      await timer(10000);
    }

    exportLeaderboard();
    console.log("🏁 Leaderboard generation complete.");
  } catch (err) {
    console.error("❌ Error generating leaderboard:", err.message);
  }
}

module.exports = {
  generateLeaderboard,
};
