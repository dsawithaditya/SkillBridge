/**
 * Scan history logger under data/history/<role>-<city>.json to compute skill trends over time.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_HISTORY_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "history"
);

let activeHistoryDir = DEFAULT_HISTORY_DIR;

export function setHistoryDir(dirPath) {
  activeHistoryDir = path.resolve(dirPath);
}

export function getHistoryDir() {
  return activeHistoryDir;
}

function slugify(value) {
  return (
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unknown"
  );
}

export function recordAndCompareSkillTrends({ role, location, demandList }) {
  if (!Array.isArray(demandList) || demandList.length === 0) return demandList || [];

  try {
    fs.mkdirSync(activeHistoryDir, { recursive: true });
    const filePath = path.join(
      activeHistoryDir,
      `${slugify(role)}-${slugify(location)}.json`
    );

    let history = [];
    if (fs.existsSync(filePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        if (Array.isArray(parsed)) history = parsed;
      } catch {
        history = [];
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    const previousEntry =
      history.length >= 2 && history[history.length - 1]?.date === today
        ? history[history.length - 2]
        : history[history.length - 1] || null;
    const prevDemand = previousEntry?.demand || null;

    const currentDemandMap = {};
    for (const item of demandList) {
      currentDemandMap[item.skill] = item.demand_pct;
    }

    const enrichedDemand = demandList.map((item) => {
      if (!prevDemand) {
        return { ...item, trend: "flat", trend_delta: 0 };
      }
      if (prevDemand[item.skill] === undefined) {
        return { ...item, trend: "new", trend_delta: item.demand_pct };
      }
      const delta = Math.round((item.demand_pct - prevDemand[item.skill]) * 10) / 10;
      const trend = delta > 0.5 ? "up" : delta < -0.5 ? "down" : "flat";
      return { ...item, trend, trend_delta: delta };
    });

    const newSnapshot = { date: today, role, location, demand: currentDemandMap };
    if (history.length > 0 && history[history.length - 1]?.date === today) {
      history[history.length - 1] = newSnapshot;
    } else {
      history.push(newSnapshot);
    }
    if (history.length > 30) {
      history = history.slice(-30);
    }
    fs.writeFileSync(filePath, JSON.stringify(history, null, 2), "utf8");
    return enrichedDemand;
  } catch {
    return demandList;
  }
}
