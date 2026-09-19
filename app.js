(() => {
  const STORAGE_KEY = "name-cup-v4"; // bump when field or modes change
  const ELO_START = 1500;
  const ELO_K = 32;

  const app = document.getElementById("app");
  const dialog = document.getElementById("standings-dialog");
  const standingsList = document.getElementById("standings-list");
  const standingsHint = document.getElementById("standings-hint");
  const standingsTitle = document.querySelector("#standings-dialog h2");
  const btnStandings = document.getElementById("btn-standings");
  const btnReset = document.getElementById("btn-reset");
  const btnExport = document.getElementById("btn-export");

  let state = normalize(load()) || homeState();

  function homeState() {
    return {
      mode: null, // 'cup' | 'rank' | null
      phase: "home",
      // cup fields
      roundIndex: 0,
      matchIndex: 0,
      queue: [],
      winners: [],
      eliminated: [],
      history: [],
      championId: null,
      seed: Date.now(),
      // rank (Elo) fields
      ratings: {},
      comparisons: {}, // "idA|idB" sorted key → count
      rankHistory: [],
      currentPair: null,
      rankPickCount: 0,
    };
  }

  function normalize(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (raw.phase === "home" || raw.phase === "playing" || raw.phase === "champion" || raw.phase === "ranking") {
      return raw;
    }
    return null;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function mulberry32(a) {
    return function () {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(list, seed) {
    const rand = mulberry32(seed >>> 0);
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function byId(id) {
    return window.BABY_NAMES.find((n) => n.id === id);
  }

  function pairKey(a, b) {
    return [a, b].sort().join("|");
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function toast(msg) {
    let el = document.querySelector(".toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    window.setTimeout(() => el.classList.remove("show"), 1800);
  }

  // —— Championship cup ————————————————————————————————

  function pairPlayers(players, seed) {
    const ordered = shuffle(players, seed);
    const matches = [];
    for (let i = 0; i < ordered.length; i += 2) {
      matches.push(
        i + 1 < ordered.length
          ? { a: ordered[i], b: ordered[i + 1] }
          : { a: ordered[i], b: null }
      );
    }
    return matches;
  }

  function roundLabel(roundIndex, remaining) {
    if (remaining <= 2 && roundIndex > 0) return "Final";
    if (remaining <= 4) return "Semifinals";
    if (remaining <= 8) return "Quarterfinals";
    return `Round ${roundIndex + 1}`;
  }

  function approxRemaining() {
    let n = state.winners.length;
    for (let i = state.matchIndex; i < state.queue.length; i++) {
      n += state.queue[i].b ? 2 : 1;
    }
    return n;
  }

  function startCup() {
    const seed = Date.now();
    state = {
      ...homeState(),
      mode: "cup",
      phase: "playing",
      seed,
      queue: pairPlayers(window.BABY_NAMES, seed),
    };
    consumeByes();
    save();
    render();
  }

  function consumeByes() {
    while (state.phase === "playing" && state.matchIndex < state.queue.length) {
      const match = state.queue[state.matchIndex];
      if (match.b !== null) break;
      state.winners.push(match.a);
      state.history.push({
        winnerId: match.a.id,
        loserId: null,
        round: state.roundIndex,
      });
      state.matchIndex += 1;
    }
    maybeAdvanceRound();
  }

  function maybeAdvanceRound() {
    if (state.matchIndex < state.queue.length) return;

    if (state.winners.length === 1) {
      state.phase = "champion";
      state.championId = state.winners[0].id;
      return;
    }

    state.roundIndex += 1;
    state.queue = pairPlayers(state.winners, state.seed + state.roundIndex * 9973);
    state.winners = [];
    state.matchIndex = 0;
    consumeByes();
  }

  function pickCup(winnerSide) {
    if (state.phase !== "playing" || state.mode !== "cup") return;
    const match = state.queue[state.matchIndex];
    if (!match || match.b === null) return;

    const winner = winnerSide === "a" ? match.a : match.b;
    const loser = winnerSide === "a" ? match.b : match.a;
    const el = document.querySelector(`[data-side="${winnerSide}"]`);
    if (el) el.classList.add("just-won");

    state.winners.push(winner);
    state.eliminated.push(loser.id);
    state.history.push({
      winnerId: winner.id,
      loserId: loser.id,
      round: state.roundIndex,
    });
    state.matchIndex += 1;

    window.setTimeout(() => {
      consumeByes();
      save();
      render();
    }, 280);
  }

  function cupRanking() {
    const farthest = new Map();
    for (const h of state.history) {
      farthest.set(h.winnerId, Math.max(farthest.get(h.winnerId) || 0, h.round + 1));
      if (h.loserId) {
        farthest.set(h.loserId, Math.max(farthest.get(h.loserId) || 0, h.round));
      }
    }
    if (state.championId) farthest.set(state.championId, 99);

    return window.BABY_NAMES.slice()
      .map((p) => ({ ...p, depth: farthest.get(p.id) || 0 }))
      .sort((a, b) => b.depth - a.depth || a.name.localeCompare(b.name));
  }

  // —— Elo ranking mode ————————————————————————————————

  function initRatings() {
    const ratings = {};
    for (const n of window.BABY_NAMES) ratings[n.id] = ELO_START;
    return ratings;
  }

  function expectedScore(ra, rb) {
    return 1 / (1 + Math.pow(10, (rb - ra) / 400));
  }

  function applyElo(winnerId, loserId) {
    const ra = state.ratings[winnerId] ?? ELO_START;
    const rb = state.ratings[loserId] ?? ELO_START;
    const ea = expectedScore(ra, rb);
    const eb = 1 - ea;
    state.ratings[winnerId] = ra + ELO_K * (1 - ea);
    state.ratings[loserId] = rb + ELO_K * (0 - eb);
  }

  function allPairs() {
    const ids = window.BABY_NAMES.map((n) => n.id);
    const pairs = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        pairs.push([ids[i], ids[j]]);
      }
    }
    return pairs;
  }

  function uniquePairCount() {
    const n = window.BABY_NAMES.length;
    return (n * (n - 1)) / 2;
  }

  /** Prefer rarely compared pairs; among ties, closer Elo (harder calls). */
  function nextRankPair() {
    const pairs = allPairs();
    const rand = mulberry32((Date.now() + state.rankPickCount * 9973) >>> 0);
    let best = null;
    let bestScore = Infinity;

    for (const [a, b] of pairs) {
      const key = pairKey(a, b);
      const count = state.comparisons[key] || 0;
      const diff = Math.abs((state.ratings[a] ?? ELO_START) - (state.ratings[b] ?? ELO_START));
      // Lower is better: few comparisons first, then close ratings
      const score = count * 10000 + diff + rand() * 0.01;
      if (score < bestScore) {
        bestScore = score;
        best = [a, b];
      }
    }

    if (!best) return null;
    // Randomize left/right
    if (rand() < 0.5) best = [best[1], best[0]];
    return { a: byId(best[0]), b: byId(best[1]) };
  }

  function startRank() {
    state = {
      ...homeState(),
      mode: "rank",
      phase: "ranking",
      ratings: initRatings(),
      comparisons: {},
      rankHistory: [],
      rankPickCount: 0,
      currentPair: null,
    };
    state.currentPair = nextRankPair();
    save();
    render();
  }

  function pickRank(winnerSide) {
    if (state.phase !== "ranking" || state.mode !== "rank" || !state.currentPair) return;
    const { a, b } = state.currentPair;
    const winner = winnerSide === "a" ? a : b;
    const loser = winnerSide === "a" ? b : a;

    const el = document.querySelector(`[data-side="${winnerSide}"]`);
    if (el) el.classList.add("just-won");

    applyElo(winner.id, loser.id);
    const key = pairKey(winner.id, loser.id);
    state.comparisons[key] = (state.comparisons[key] || 0) + 1;
    state.rankHistory.push({ winnerId: winner.id, loserId: loser.id });
    state.rankPickCount += 1;
    state.currentPair = nextRankPair();

    window.setTimeout(() => {
      save();
      render();
    }, 280);
  }

  function eloRanking() {
    return window.BABY_NAMES.slice()
      .map((p) => ({
        ...p,
        rating: state.ratings[p.id] ?? ELO_START,
        wins: state.rankHistory.filter((h) => h.winnerId === p.id).length,
        losses: state.rankHistory.filter((h) => h.loserId === p.id).length,
      }))
      .sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
  }

  function pairsCompletedOnce() {
    return allPairs().filter(([a, b]) => (state.comparisons[pairKey(a, b)] || 0) > 0).length;
  }

  // —— Shared UI ————————————————————————————————————————

  function goHome() {
    if (
      state.phase !== "home" &&
      !confirm("Leave this game? Progress for this session will be cleared.")
    ) {
      return;
    }
    state = homeState();
    save();
    render();
  }

  function rankingForExport() {
    if (state.mode === "rank") {
      return eloRanking().map((p, i) => `${i + 1}. ${p.name} (${Math.round(p.rating)})`);
    }
    return cupRanking().map((p, i) => `${i + 1}. ${p.name}`);
  }

  async function exportRanking() {
    const title =
      state.mode === "rank" ? "The Name Cup — Elo ranking" : "The Name Cup — championship";
    const text = [title, ...rankingForExport()].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast("Ranking copied");
    } catch {
      toast("Could not copy");
    }
  }

  function openStandings() {
    if (state.mode === "rank") {
      standingsTitle.textContent = "Elo ranking";
      const ranked = eloRanking();
      standingsList.innerHTML = ranked
        .map(
          (p) =>
            `<li><strong>${escapeHtml(p.name)}</strong> — ${Math.round(p.rating)} · ${p.wins}–${p.losses}</li>`
        )
        .join("");
      standingsHint.textContent =
        "Higher Elo = preferred more often. Keep dueling to refine the order.";
    } else {
      standingsTitle.textContent = "Cup standings";
      const ranked = cupRanking();
      standingsList.innerHTML = ranked
        .map((p) => {
          const tag =
            p.id === state.championId
              ? " — champion"
              : p.depth === 0 && state.history.length
                ? " — not played"
                : "";
          return `<li><strong>${escapeHtml(p.name)}</strong>${tag}</li>`;
        })
        .join("");
      standingsHint.textContent =
        state.phase === "home"
          ? "Start a game to build a ranking."
          : "Order is by how far each name advanced in this cup — not a full preference order.";
    }
    if (typeof dialog.showModal === "function") dialog.showModal();
  }

  function renderHome() {
    const n = window.BABY_NAMES.length;
    const pairs = uniquePairCount();
    app.innerHTML = `
      <section class="screen hero-copy">
        <h2>Two games. Same ${n} names.</h2>
        <p>Pick how you and Claire want to decide — a quick champion, or a real ordered ranking.</p>
        <div class="mode-grid">
          <button type="button" class="mode-card" id="btn-start-cup">
            <span class="mode-eyebrow">Championship</span>
            <span class="mode-title">The Cup</span>
            <span class="mode-body">Single-elimination bracket. One winner. Fast — about ${n - 1} picks.</span>
          </button>
          <button type="button" class="mode-card mode-card-accent" id="btn-start-rank">
            <span class="mode-eyebrow">Ranking</span>
            <span class="mode-title">Elo duels</span>
            <span class="mode-body">Keep picking pairs. Scores update until you have a full 1–${n} order. ${pairs} unique pairs to cover once.</span>
          </button>
        </div>
      </section>
    `;
    document.getElementById("btn-start-cup").addEventListener("click", startCup);
    document.getElementById("btn-start-rank").addEventListener("click", startRank);
  }

  function renderCupMatch() {
    const match = state.queue[state.matchIndex];
    if (!match) {
      app.innerHTML = `<p class="screen">Bracket glitch — go Home and start again.</p>`;
      return;
    }
    if (!match.b) {
      consumeByes();
      save();
      render();
      return;
    }

    const realMatches = state.queue.filter((m) => m.b);
    const played = state.history.filter((h) => h.round === state.roundIndex && h.loserId).length;
    const label = roundLabel(state.roundIndex, approxRemaining());
    const pct = realMatches.length ? Math.round((played / realMatches.length) * 100) : 0;

    app.innerHTML = `
      <section class="screen">
        <div class="round-meta">
          <div class="label">${label}</div>
          <div class="progress">Match ${played + 1} of ${realMatches.length} · ${approxRemaining()} names left</div>
        </div>
        <div class="progress-track" aria-hidden="true"><div class="progress-fill" style="width:${pct}%"></div></div>
        ${matchupHtml(match.a, match.b, "Tap to advance")}
        <p class="kbd-hint">Keyboard: <kbd>1</kbd> / <kbd>←</kbd> left · <kbd>2</kbd> / <kbd>→</kbd> right</p>
      </section>
    `;
    bindPicks(pickCup);
  }

  function renderChampion() {
    const champ = byId(state.championId);
    const top = cupRanking().slice(0, 4);
    app.innerHTML = `
      <section class="screen champion">
        <div class="trophy">Champion of the cup</div>
        <h2>${escapeHtml(champ?.name || "?")}</h2>
        <p>Survived every matchup. For a full 1–${window.BABY_NAMES.length} order, try <strong>Elo duels</strong> from Home.</p>
        <div class="cta-row" style="justify-content:center">
          <button type="button" class="primary" id="btn-again">Play another cup</button>
          <button type="button" class="ghost" id="btn-try-rank">Try Elo ranking</button>
          <button type="button" class="ghost" id="btn-open-standings">See placement</button>
        </div>
        <div class="final-four">
          <h3>Placement (by how far they went)</h3>
          <ol>
            ${top.map((p) => `<li>${escapeHtml(p.name)}</li>`).join("")}
          </ol>
        </div>
      </section>
    `;
    document.getElementById("btn-again").addEventListener("click", startCup);
    document.getElementById("btn-try-rank").addEventListener("click", startRank);
    document.getElementById("btn-open-standings").addEventListener("click", openStandings);
  }

  function renderRankMatch() {
    const pair = state.currentPair;
    if (!pair || !pair.a || !pair.b) {
      app.innerHTML = `<p class="screen">No pairs left — go Home.</p>`;
      return;
    }

    const done = pairsCompletedOnce();
    const total = uniquePairCount();
    const pct = Math.min(100, Math.round((done / total) * 100));
    const ranked = eloRanking();
    const passLabel =
      done >= total
        ? `Full pass done · pick ${state.rankPickCount} — keep going to refine`
        : `Unique pairs covered ${done} of ${total}`;

    app.innerHTML = `
      <section class="screen">
        <div class="round-meta">
          <div class="label">Elo duel</div>
          <div class="progress">${passLabel}</div>
        </div>
        <div class="progress-track" aria-hidden="true"><div class="progress-fill" style="width:${pct}%"></div></div>
        ${matchupHtml(pair.a, pair.b, "Tap who you prefer")}
        <p class="kbd-hint">Keyboard: <kbd>1</kbd> / <kbd>←</kbd> left · <kbd>2</kbd> / <kbd>→</kbd> right</p>
        <div class="live-rank">
          <h3>Live ranking</h3>
          <ol>
            ${ranked
              .map(
                (p) =>
                  `<li><strong>${escapeHtml(p.name)}</strong> <span class="rating">${Math.round(p.rating)}</span></li>`
              )
              .join("")}
          </ol>
        </div>
      </section>
    `;
    bindPicks(pickRank);
  }

  function matchupHtml(a, b, hint) {
    return `
      <div class="matchup" role="group" aria-label="Choose a name">
        <button type="button" class="name-pick" data-side="a" id="pick-a">
          <span class="name">${escapeHtml(a.name)}</span>
          ${a.note ? `<p class="note">${escapeHtml(a.note)}</p>` : ""}
          <span class="hint-pick">${escapeHtml(hint)}</span>
        </button>
        <div class="vs" aria-hidden="true">vs</div>
        <button type="button" class="name-pick" data-side="b" id="pick-b">
          <span class="name">${escapeHtml(b.name)}</span>
          ${b.note ? `<p class="note">${escapeHtml(b.note)}</p>` : ""}
          <span class="hint-pick">${escapeHtml(hint)}</span>
        </button>
      </div>
    `;
  }

  function bindPicks(fn) {
    document.getElementById("pick-a").addEventListener("click", () => fn("a"));
    document.getElementById("pick-b").addEventListener("click", () => fn("b"));
  }

  function render() {
    const active =
      state.phase === "playing" ||
      state.phase === "champion" ||
      state.phase === "ranking";
    btnStandings.hidden = !active;
    btnReset.hidden = state.phase === "home";
    btnReset.textContent = "Home";

    if (state.phase === "home") renderHome();
    else if (state.phase === "playing") renderCupMatch();
    else if (state.phase === "champion") renderChampion();
    else if (state.phase === "ranking") renderRankMatch();
  }

  btnStandings.addEventListener("click", openStandings);
  btnReset.addEventListener("click", goHome);
  btnExport.addEventListener("click", exportRanking);

  window.addEventListener("keydown", (e) => {
    if (dialog.open) return;
    if (state.phase === "playing" && state.mode === "cup") {
      if (e.key === "1" || e.key === "ArrowLeft") {
        e.preventDefault();
        pickCup("a");
      } else if (e.key === "2" || e.key === "ArrowRight") {
        e.preventDefault();
        pickCup("b");
      }
    } else if (state.phase === "ranking" && state.mode === "rank") {
      if (e.key === "1" || e.key === "ArrowLeft") {
        e.preventDefault();
        pickRank("a");
      } else if (e.key === "2" || e.key === "ArrowRight") {
        e.preventDefault();
        pickRank("b");
      }
    }
  });

  if (
    state.phase !== "playing" &&
    state.phase !== "champion" &&
    state.phase !== "ranking"
  ) {
    state = homeState();
  }
  render();
})();
