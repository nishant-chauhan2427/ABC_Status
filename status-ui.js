/*
 * ABC Platform Status — the home page.
 *
 * Upptime builds this site; .upptimerc.yml loads this file and status-ui.css on every
 * page. On the home page it hides Upptime's own layout (#sapper) and renders:
 * an overall status banner, ongoing incidents, every component with a bar per day
 * for the last 90 days (30 on a phone) and its uptime, a tooltip per day with the
 * downtime and the incidents behind it, and the past incidents. Incident pages stay
 * Upptime's.
 *
 * Data, both written by the Upptime workflows:
 *   - history/summary.json — each component's current status and `dailyMinutesDown`
 *   - history/<slug>.yml   — `startTime`, when monitoring began (older days: "No data")
 *   - GitHub issues labelled `status` (+ the component's slug) — the incidents
 *   - comments on those issues — the incident's updates ("Investigating - …"),
 *     shown only from the repo's owner, members, collaborators and the Upptime bot
 * The repository must be public: visitors' browsers read these directly.
 */
(function () {
  "use strict";

  if (window.__abcStatusUi) return; // Sapper re-inserts head scripts when it hydrates.
  window.__abcStatusUi = true;

  var CONFIG = {
    owner: "nishant-chauhan2427",
    repo: "ABC_Status",
    branch: "master",
    title: "ABC Platform Status",
    logo: "abc_logo.png", // assets/, served beside this file
    appUrl: "https://insights.abcconsultants.in/",
    appLabel: "Open ABC Insights",
    days: 90,
    phoneDays: 30,
    phoneWidth: 640,
    historyDays: 14,
    // Visitors share GitHub's 60 API calls an hour per IP (a whole office is one IP).
    cacheMs: 5 * 60 * 1000,
    // Optional one-line explanations, by Upptime slug (the component name, kebab-cased).
    descriptions: {
      frontend: "The web app at insights.abcconsultants.in",
      "shared-service": "Sign-in, users, roles, clients and master data",
      "shared-database": "The database behind the Shared service",
      "afs-service": "PBC, billing, receivables, MIS and dashboards",
      "afs-database": "The database behind the AFS service",
      "cache-redis": "Speeds up the app; it keeps working without it, only slower",
    },
  };

  // A local preview can point both at its own mock files (window.ABC_STATUS_SOURCE = { raw, api }).
  var SOURCE = window.ABC_STATUS_SOURCE || {};
  var RAW = SOURCE.raw || "https://raw.githubusercontent.com/" + CONFIG.owner + "/" + CONFIG.repo + "/" + CONFIG.branch;
  var API = SOURCE.api || "https://api.github.com/repos/" + CONFIG.owner + "/" + CONFIG.repo;
  var DAY_MS = 86400000;

  var LEVEL_LABEL = {
    ok: "Operational",
    minor: "Degraded performance",
    partial: "Partial outage",
    major: "Major outage",
    nodata: "No data",
  };

  var ICON = {
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0ZM12 9a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0v-4a1 1 0 0 1 1-1Zm0 8.2a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4Z"/></svg>',
  };

  // ── Routing: only the home page is taken over ─────────────────────────────

  function basePath() {
    var base = document.querySelector("base");
    var href = base ? base.getAttribute("href") : "/";
    try {
      return new URL(href, location.href).pathname.replace(/\/+$/, "");
    } catch (e) {
      return "";
    }
  }

  function isHome() {
    var path = location.pathname.replace(/\/+$/, "").replace(/\/index\.html$/, "");
    return path === basePath();
  }

  function syncRoute() {
    var home = isHome();
    document.documentElement.classList.toggle("abc-home", home);
    if (home) mount();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === "text") node.textContent = attrs[key];
      else if (key === "html") node.innerHTML = attrs[key]; // only ever our own static SVG
      else if (attrs[key] !== undefined && attrs[key] !== null) node.setAttribute(key, attrs[key]);
    });
    (children || []).forEach(function (child) {
      if (child) node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }

  // An external link Sapper must not route client-side (rel=external).
  function link(href, text) {
    return el("a", { href: href, rel: "external noopener", text: text });
  }

  function utcKey(time) {
    return new Date(time).toISOString().slice(0, 10);
  }

  function dayStart(key) {
    return Date.parse(key + "T00:00:00Z");
  }

  function formatDay(key) {
    return new Date(dayStart(key)).toLocaleDateString("en-GB", {
      day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
    });
  }

  // Incident times are UTC, like the day bars and the updates.
  function formatDateTime(time) {
    var d = new Date(time);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) +
      ", " + d.toISOString().slice(11, 16) + " UTC";
  }

  function formatDuration(minutes) {
    var m = Math.max(0, Math.round(minutes));
    if (m < 60) return m + " min" + (m === 1 ? "" : "s");
    var h = Math.floor(m / 60);
    return h + " hr" + (h === 1 ? "" : "s") + " " + (m % 60) + " mins";
  }

  function readCache(key) {
    try {
      var item = JSON.parse(localStorage.getItem(key) || "null");
      if (item && Date.now() - item.at < CONFIG.cacheMs) return item.data;
    } catch (e) { /* private mode, blocked storage: just fetch */ }
    return null;
  }

  function writeCache(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({ at: Date.now(), data: data }));
    } catch (e) { /* ignore */ }
  }

  function fetchJson(url, cacheKey) {
    var cached = cacheKey && readCache(cacheKey);
    if (cached) return Promise.resolve(cached);
    return nativeFetch(url, { headers: { Accept: "application/vnd.github+json" } }).then(function (res) {
      if (!res.ok) throw new Error(url + " → " + res.status);
      return res.json();
    }).then(function (data) {
      if (cacheKey) writeCache(cacheKey, data);
      return data;
    });
  }

  function fetchStartTime(slug) {
    return nativeFetch(RAW + "/history/" + slug + ".yml").then(function (res) {
      return res.ok ? res.text() : "";
    }).then(function (text) {
      var match = /startTime:\s*["']?([0-9T:.\-+Z ]+)/.exec(text);
      return match ? Date.parse(match[1].trim()) || null : null;
    }).catch(function () { return null; });
  }

  // ── Model ─────────────────────────────────────────────────────────────────

  function issueKind(issue) {
    var title = issue.title || "";
    if (/degraded/i.test(title) || title.indexOf("⚠") === 0) return "minor";
    return "down";
  }

  function issueTitle(issue) {
    return (issue.title || "").replace(/^[\s🛑⚠️️]+/u, "").trim();
  }

  function issueSpan(issue) {
    var start = Date.parse(issue.created_at);
    var end = issue.closed_at ? Date.parse(issue.closed_at) : Date.now();
    return { start: start, end: Math.max(start, end) };
  }

  // ── Incident updates ──────────────────────────────────────────────────────
  // The team posts an update as a comment on the incident's issue, starting with its
  // stage: "Investigating - We are looking into …". Upptime's bot adds "Resolved".

  var STAGES = ["investigating", "identified", "monitoring", "update", "resolved", "detected"];
  var STAGE_RE = new RegExp("^[\\s*_]*(" + STAGES.join("|") + ")[\\s*_]*[:\\-–—]?[\\s*_]*", "i");
  // A public repo lets anyone comment; only these voices reach the page.
  var TRUSTED = ["OWNER", "MEMBER", "COLLABORATOR"];

  function trusted(item) {
    return TRUSTED.indexOf(item.author_association) > -1 || (item.user && item.user.type === "Bot");
  }

  /** Markdown as plain text: the page shows it with textContent, never as HTML. */
  function plainText(markdown) {
    return String(markdown || "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/[*_`#>]+/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function toUpdate(body, time, fallbackStage) {
    var text = String(body || "");
    var match = STAGE_RE.exec(text);
    var stage = match ? match[1] : fallbackStage;
    var rest = plainText(match ? text.slice(match[0].length) : text).replace(/^\w/, function (c) { return c.toUpperCase(); });
    return { stage: stage.charAt(0).toUpperCase() + stage.slice(1).toLowerCase(), text: rest, time: Date.parse(time) };
  }

  function groupComments(comments) {
    var byIssue = {};
    comments.forEach(function (comment) {
      var number = Number(String(comment.issue_url || "").split("/").pop());
      if (!number || !trusted(comment) || !String(comment.body || "").trim()) return;
      (byIssue[number] = byIssue[number] || []).push(toUpdate(comment.body, comment.created_at, "Update"));
    });
    return byIssue;
  }

  /** An incident's updates, newest first: the opening note, the team's comments, the close. */
  function incidentUpdates(issue) {
    var updates = (state.updates[issue.number] || []).slice();
    // An issue a person opened carries its first note in the body; the bot's body is
    // only the check's raw result, so it reads as the detection.
    var opening = issue.user && issue.user.type !== "Bot" && trusted(issue) && plainText(issue.body)
      ? toUpdate(issue.body, issue.created_at, "Investigating")
      : { stage: "Detected", text: "Found by automatic monitoring: " + issueTitle(issue) + ".", time: Date.parse(issue.created_at) };
    updates.push(opening);
    var resolved = updates.some(function (u) { return u.stage === "Resolved"; });
    if (issue.state === "closed" && !resolved) {
      updates.push({ stage: "Resolved", text: "This incident has been resolved.", time: Date.parse(issue.closed_at) });
    }
    return updates.sort(function (a, b) { return b.time - a.time; });
  }

  function formatUpdateTime(time) {
    var d = new Date(time);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) +
      " - " + d.toISOString().slice(11, 16) + " UTC";
  }

  function renderUpdates(issue, className) {
    return el("div", { class: className }, incidentUpdates(issue).map(function (update) {
      return el("div", { class: "abc-update" }, [
        el("p", {}, [el("strong", { text: update.stage }), update.text ? " - " + update.text : ""]),
        el("time", { datetime: new Date(update.time).toISOString(), text: formatUpdateTime(update.time) }),
      ]);
    }));
  }

  function hasLabel(issue, name) {
    return (issue.labels || []).some(function (label) {
      return (typeof label === "string" ? label : label.name) === name;
    });
  }

  /** The bar for one component on one UTC day. */
  function dayCell(site, key, issues, startTime) {
    var from = dayStart(key);
    var to = from + DAY_MS;
    if (startTime && to <= startTime) return { key: key, level: "nodata", minutes: 0, incidents: [] };

    var incidents = issues.filter(function (issue) {
      var span = issueSpan(issue);
      return hasLabel(issue, site.slug) && span.start < to && span.end > from;
    });
    var minutes = (site.dailyMinutesDown || {})[key] || 0;
    var level = "ok";
    if (minutes > 0 || incidents.length) {
      var down = incidents.some(function (issue) { return issueKind(issue) === "down"; });
      if (!incidents.length || down) level = minutes >= 60 ? "major" : "partial";
      else level = "minor";
    }
    return { key: key, level: level, minutes: minutes, incidents: incidents };
  }

  function dayKeys(count) {
    var today = dayStart(utcKey(Date.now()));
    var keys = [];
    for (var i = count - 1; i >= 0; i--) keys.push(utcKey(today - i * DAY_MS));
    return keys;
  }

  function uptimePercent(cells) {
    var counted = cells.filter(function (c) { return c.level !== "nodata"; });
    if (!counted.length) return null;
    var down = counted.reduce(function (sum, c) { return sum + Math.min(c.minutes, 1440); }, 0);
    return Math.max(0, 100 - (down / (counted.length * 1440)) * 100);
  }

  function currentLevel(site) {
    if (site.status === "down") return "major";
    if (site.status === "degraded") return "minor";
    return "ok";
  }

  function overall(sites) {
    var down = sites.filter(function (s) { return s.status === "down"; }).length;
    var degraded = sites.filter(function (s) { return s.status === "degraded"; }).length;
    if (down && down === sites.length) return { level: "major", text: "Major system outage" };
    if (down) return { level: "partial", text: "Partial system outage" };
    if (degraded) return { level: "minor", text: "Degraded performance" };
    return { level: "ok", text: "All systems operational" };
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  var root;
  var renderedDays = 0;
  var state = { sites: null, issues: [], updates: {}, startTimes: {}, error: null, incidentsMissing: false };

  function mount() {
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", mount, { once: true });
      return;
    }
    if (root && document.body.contains(root)) return;
    root = el("div", { id: "abc-status" });
    document.body.appendChild(root);
    document.title = CONFIG.title;
    render();
    load();
    // Redrawn only when the day count changes (phone ↔ wider): any other resize keeps
    // the page — and an open tooltip — as it is.
    var resizeTimer;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (isHome() && visibleDays() !== renderedDays) render();
      }, 150);
    });
  }

  function visibleDays() {
    return window.innerWidth <= CONFIG.phoneWidth ? CONFIG.phoneDays : CONFIG.days;
  }

  function load() {
    state.error = null;
    Promise.all([
      fetchJson(RAW + "/history/summary.json", "abc-status-summary"),
      // GitHub allows 60 API calls an hour per IP. Past that the bars still draw from
      // summary.json (not limited) and the page says incidents are missing.
      fetchJson(API + "/issues?labels=status&state=all&sort=created&direction=desc&per_page=100", "abc-status-issues")
        .catch(function () { return null; }),
      // The newest comments on every issue, in one call — one per incident would spend
      // a visitor's 60 GitHub API requests an hour.
      fetchJson(API + "/issues/comments?sort=created&direction=desc&per_page=100", "abc-status-comments")
        .catch(function () { return []; }),
    ]).then(function (results) {
      state.sites = results[0];
      state.incidentsMissing = results[1] === null;
      state.issues = (results[1] || []).filter(function (issue) { return !issue.pull_request; });
      state.updates = groupComments(results[2] || []);
      render();
      return Promise.all(state.sites.map(function (site) {
        return fetchStartTime(site.slug).then(function (time) { state.startTimes[site.slug] = time; });
      }));
    }).then(function () {
      if (state.sites) render();
    }).catch(function (error) {
      state.error = error;
      render();
    });
  }

  function render() {
    if (!root) return;
    hideTip();
    var days = renderedDays = visibleDays();
    root.textContent = "";
    root.appendChild(renderHeader());
    var main = el("main", { class: "abc-main" }, [el("div", { class: "abc-wrap" }, [
      renderBanner(),
      state.incidentsMissing
        ? el("p", { class: "abc-notice", role: "status", text: "Incident details could not be loaded right now (GitHub's hourly limit for this network). The component status and bars below are current; try again in a few minutes." })
        : null,
      renderActive(),
      el("p", { class: "abc-caption", text: "Uptime over the past " + days + " days." }),
      renderComponents(days),
      renderHistory(),
    ])]);
    root.appendChild(main);
    root.appendChild(renderFooter());
    root.appendChild(tip);
  }

  function renderHeader() {
    return el("header", { class: "abc-header" }, [el("div", { class: "abc-wrap" }, [
      el("a", { class: "abc-brand", href: "./", rel: "external" }, [
        el("img", { src: CONFIG.logo, alt: "" }),
        el("span", { text: CONFIG.title }),
      ]),
      el("a", { class: "abc-header-link", href: CONFIG.appUrl, rel: "external noopener", text: CONFIG.appLabel }),
    ])]);
  }

  function renderBanner() {
    if (state.error) {
      var retry = el("button", { type: "button", text: "Try again" });
      retry.addEventListener("click", function () { state.sites = null; render(); load(); });
      return el("div", { class: "abc-banner", "data-level": "error", role: "status" }, [
        el("span", {}, ["Status could not be loaded", el("small", { text: "The status data did not load. Check your connection and try again." })]),
        retry,
      ]);
    }
    if (!state.sites) {
      return el("div", { class: "abc-banner", "data-level": "loading", role: "status", text: "Checking status…" });
    }
    var o = overall(state.sites);
    return el("div", { class: "abc-banner", "data-level": o.level, role: "status" }, [
      el("span", { html: o.level === "ok" ? ICON.ok : ICON.warn }),
      el("span", { text: o.text }),
    ]);
  }

  function renderActive() {
    var open = state.issues.filter(function (issue) { return issue.state === "open"; });
    if (!open.length) return null;
    return el("section", { class: "abc-active", "aria-label": "Ongoing incidents" }, open.map(function (issue) {
      return el("article", { class: "abc-active-card", "data-level": issueKind(issue) === "minor" ? "minor" : "major" }, [
        el("header", {}, [
          el("h3", {}, [link(issue.html_url, issueTitle(issue))]),
          el("span", { text: "Ongoing since " + formatDateTime(issue.created_at) }),
        ]),
        renderUpdates(issue, "abc-updates"),
      ]);
    }));
  }

  function renderComponents(days) {
    var keys = dayKeys(days);
    var list = el("div", { class: "abc-components" });
    var sites = state.sites || Object.keys(CONFIG.descriptions).map(function (slug) {
      return { slug: slug, name: slug.replace(/-/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); }), loading: true };
    });

    sites.forEach(function (site) {
      var cells = site.loading
        ? keys.map(function (key) { return { key: key, level: "loading" }; })
        : keys.map(function (key) { return dayCell(site, key, state.issues, state.startTimes[site.slug]); });
      var level = site.loading ? "nodata" : currentLevel(site);
      var uptime = site.loading ? null : uptimePercent(cells);

      var bars = el("div", {
        class: "abc-bars",
        role: "img",
        tabindex: site.loading ? null : "0",
        "aria-label": site.name + ": " + (uptime === null ? "no data" : uptime.toFixed(2) + "% uptime") +
          " over the past " + days + " days. Use the arrow keys to read each day.",
      }, cells.map(function (cell, index) {
        return el("span", { class: "abc-bar", "data-level": cell.level, "data-index": String(index) });
      }));
      if (!site.loading) wireBars(bars, site, cells);

      list.appendChild(el("section", { class: "abc-component" }, [
        el("div", { class: "abc-component-head" }, [
          el("div", {}, [
            el("h2", { class: "abc-component-name", text: site.name }),
            CONFIG.descriptions[site.slug] ? el("p", { class: "abc-component-desc", text: CONFIG.descriptions[site.slug] }) : null,
          ]),
          el("span", { class: "abc-state", "data-level": level, text: site.loading ? "" : LEVEL_LABEL[level] }),
        ]),
        bars,
        el("div", { class: "abc-axis" }, [
          el("span", { text: days + " days ago" }),
          el("span", { class: "abc-rule" }),
          uptime === null ? null : el("span", { text: uptime.toFixed(2).replace(/\.?0+$/, "") + " % uptime" }),
          uptime === null ? null : el("span", { class: "abc-rule" }),
          el("span", { text: "Today" }),
        ]),
      ]));
    });
    return list;
  }

  // ── Tooltip ───────────────────────────────────────────────────────────────

  var tip = el("div", { class: "abc-tip", role: "tooltip", id: "abc-tip", hidden: "" });
  var tipOwner = null;
  var pinned = false;

  function hideTip() {
    tip.hidden = true;
    pinned = false;
    if (tipOwner) {
      tipOwner.classList.remove("abc-has-active");
      tipOwner.removeAttribute("aria-describedby");
      Array.prototype.forEach.call(tipOwner.querySelectorAll(".abc-active-bar"), function (bar) {
        bar.classList.remove("abc-active-bar");
      });
    }
    tipOwner = null;
  }

  function showTip(bars, bar, cell, site) {
    if (tipOwner && tipOwner !== bars) hideTip();
    tipOwner = bars;
    Array.prototype.forEach.call(bars.querySelectorAll(".abc-active-bar"), function (b) { b.classList.remove("abc-active-bar"); });
    bar.classList.add("abc-active-bar");
    bars.classList.add("abc-has-active");
    bars.setAttribute("aria-describedby", "abc-tip");

    tip.textContent = "";
    tip.appendChild(el("p", { class: "abc-tip-date", text: formatDay(cell.key) }));
    if (cell.level === "ok") {
      tip.appendChild(el("p", { class: "abc-tip-note", text: "No downtime recorded on this day." }));
    } else if (cell.level === "nodata") {
      tip.appendChild(el("p", { class: "abc-tip-note", text: "No data — " + site.name + " was not monitored yet." }));
    } else {
      tip.appendChild(el("div", { class: "abc-tip-box", "data-level": cell.level }, [
        el("span", { html: ICON.warn }),
        el("span", { text: LEVEL_LABEL[cell.level] }),
        el("span", { class: "abc-tip-time", text: formatDuration(cell.minutes) }),
      ]));
      if (cell.incidents.length) {
        tip.appendChild(el("h4", { text: "Related" }));
        tip.appendChild(el("ul", {}, cell.incidents.map(function (issue) {
          return el("li", {}, [link(issue.html_url, issueTitle(issue))]);
        })));
      }
    }

    tip.hidden = false;
    var barBox = bar.getBoundingClientRect();
    var rootBox = root.getBoundingClientRect();
    var width = tip.offsetWidth;
    var center = barBox.left + barBox.width / 2;
    var left = Math.min(Math.max(center - width / 2, 16), document.documentElement.clientWidth - width - 16);
    tip.style.left = left - rootBox.left + "px";
    tip.style.top = barBox.bottom - rootBox.top + 12 + "px";
    tip.style.setProperty("--abc-arrow", Math.min(Math.max(center - left, 14), width - 14) + "px");
  }

  function wireBars(bars, site, cells) {
    var active = -1;
    function show(index) {
      active = Math.max(0, Math.min(cells.length - 1, index));
      showTip(bars, bars.children[active], cells[active], site);
    }
    bars.addEventListener("mouseover", function (event) {
      if (pinned) return;
      var index = event.target.getAttribute && event.target.getAttribute("data-index");
      if (index !== null && index !== undefined) show(Number(index));
    });
    bars.addEventListener("mouseleave", function () {
      if (!pinned) setTimeout(function () { if (!pinned && !tip.matches(":hover")) hideTip(); }, 80);
    });
    // Tap or click pins the tooltip (touch has no hover); a second tap on the same day closes it.
    bars.addEventListener("click", function (event) {
      var index = event.target.getAttribute && event.target.getAttribute("data-index");
      if (index === null || index === undefined) return;
      event.stopPropagation();
      if (pinned && active === Number(index)) { hideTip(); return; }
      show(Number(index));
      pinned = true;
    });
    bars.addEventListener("keydown", function (event) {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        show(active < 0 ? cells.length - 1 : active + (event.key === "ArrowRight" ? 1 : -1));
        pinned = true;
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        show(event.key === "Home" ? 0 : cells.length - 1);
        pinned = true;
      } else if (event.key === "Escape") {
        hideTip();
      }
    });
    bars.addEventListener("blur", function () {
      setTimeout(function () { if (!tip.contains(document.activeElement)) hideTip(); }, 0);
    });
  }

  tip.addEventListener("mouseleave", function () { if (!pinned) hideTip(); });
  document.addEventListener("click", function (event) {
    if (!tip.hidden && !tip.contains(event.target)) hideTip();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") hideTip();
  });

  // ── Past incidents ────────────────────────────────────────────────────────

  function renderHistory() {
    var section = el("section", { class: "abc-history", "aria-labelledby": "abc-history-title" }, [
      el("h2", { id: "abc-history-title", text: "Past incidents" }),
    ]);
    if (!state.sites) return section;
    var byDay = {};
    state.issues.forEach(function (issue) {
      var key = utcKey(issue.created_at);
      (byDay[key] = byDay[key] || []).push(issue);
    });
    dayKeys(CONFIG.historyDays).reverse().forEach(function (key) {
      var issues = byDay[key] || [];
      section.appendChild(el("div", { class: "abc-day" }, [
        el("h3", { text: formatDay(key) }),
        issues.length ? null : el("p", { class: "abc-day-empty", text: "No incidents reported." }),
      ].concat(issues.map(function (issue) {
        var span = issueSpan(issue);
        if (issue.state === "open") {
          return el("article", { class: "abc-incident", "data-level": issueKind(issue) === "minor" ? "minor" : "major" }, [
            el("h4", {}, [link(issue.html_url, issueTitle(issue))]),
            el("p", { text: "Ongoing since " + formatDateTime(span.start) + " — updates above." }),
          ]);
        }
        var status = "Resolved after " + formatDuration((span.end - span.start) / 60000) + " — " +
            formatDateTime(span.start) + " to " + formatDateTime(span.end);
        return el("article", { class: "abc-incident", "data-level": issueKind(issue) === "minor" ? "minor" : "major" }, [
          el("h4", {}, [link(issue.html_url, issueTitle(issue))]),
          el("p", { text: status }),
          renderUpdates(issue, "abc-updates abc-updates-compact"),
        ]);
      }))));
    });
    section.appendChild(el("p", { class: "abc-more" }, [
      link("https://github.com/" + CONFIG.owner + "/" + CONFIG.repo + "/issues?q=label%3Astatus", "Incident history →"),
    ]));
    return section;
  }

  function renderFooter() {
    return el("footer", { class: "abc-footer" }, [el("div", { class: "abc-wrap" }, [
      el("span", { text: "Checked every 5 minutes from outside our servers. Times on the bars are UTC days." }),
      el("span", {}, ["Powered by ", link("https://upptime.js.org", "Upptime")]),
    ])]);
  }
  // ── Upptime's own home page, kept quiet ───────────────────────────────────
  // Upptime's home components still mount (hidden) and each visit spends 4 GitHub API
  // calls; when an IP runs out, Upptime sends the whole page to /rate-limit-exceeded.
  // This page needs none of it, so on the home page their GitHub API calls are answered
  // with an empty list here, before they reach the network. This file loads in <head>,
  // before Upptime's components mount. Other pages (incidents) keep their calls.
  var nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    if (isHome() && url.indexOf("https://api.github.com/") === 0) {
      return Promise.resolve(new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return nativeFetch(input, init);
  };

  // ── Start ─────────────────────────────────────────────────────────────────
  // Runs from <head>, before the body is parsed, so Upptime's page never flashes on
  // the home page. Sapper navigates with pushState, so a client-side move to or from
  // the home page re-checks.
  syncRoute();
  ["pushState", "replaceState"].forEach(function (name) {
    var original = history[name];
    history[name] = function () {
      var result = original.apply(this, arguments);
      syncRoute();
      return result;
    };
  });
  window.addEventListener("popstate", syncRoute);
})();
