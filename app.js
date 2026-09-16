(() => {
  const STORAGE_KEY = "name-cup-v1";
  const app = document.getElementById("app");
  const dialog = document.getElementById("standings-dialog");
  const standingsList = document.getElementById("standings-list");
  const standingsHint = document.getElementById("standings-hint");
  const btnStandings = document.getElementById("btn-standings");
  const btnReset = document.getElementById("btn-reset");
  const btnExport = document.getElementById("btn-export");

  let state = load() || homeState();

  function homeState() {
    return {
      phase: "home",
      roundIndex: 0,
      matchIndex: 0,
      queue: [],
      winners: [],
      eliminated: [],
      history: [],
      championId: null,
      seed: Date.now(),
    };
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
      phase: "playing",
      roundIndex: 0,
      matchIndex: 0,
      queue: pairPlayers(window.BABY_NAMES, seed),
      winners: [],
      eliminated: [],
      history: [],
      championId: null,
      seed,
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

  function pick(winnerSide) {
    if (state.phase !== "playing") return;
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

  function resetCup() {
    if (
      state.phase !== "home" &&
      !confirm("Start a new cup? Current bracket progress will be cleared.")
    ) {
      return;
    }
    state = homeState();
    save();
    render();
  }

  function ranking() {
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

  async function exportRanking() {
    const text = ["The Name Cup ranking", ...ranking().map((p, i) => `${i + 1}. ${p.name}`)].join(
      "\n"
    );
    try {
      await navigator.clipboard.writeText(text);
      toast("Ranking copied");
    } catch {
      toast("Could not copy");
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function openStandings() {
    const ranked = ranking();
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
        ? "Start a cup to build a ranking."
        : "Order is by how far each name advanced in this cup.";
    if (typeof dialog.showModal === "function") dialog.showModal();
  }

  function renderHome() {
    app.innerHTML = `
      <section class="screen hero-copy">
        <h2>One match. Two names. Pick who advances.</h2>
        <p>
          Single-elimination cup for all ${window.BABY_NAMES.length} contenders.
          Winners move on; odd names get a bye. Progress saves in this browser
          so you can pause with Claire.
        </p>
        <div class="cta-row">
          <button type="button" class="primary" id="btn-start">Start the cup</button>
        </div>
      </section>
    `;
    document.getElementById("btn-start").addEventListener("click", startCup);
  }

  function renderMatch() {
    const match = state.queue[state.matchIndex];
    if (!match) {
      app.innerHTML = `<p class="screen">Bracket glitch — try New cup.</p>`;
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
        <div class="matchup" role="group" aria-label="Choose a name">
          <button type="button" class="name-pick" data-side="a" id="pick-a">
            <span class="name">${escapeHtml(match.a.name)}</span>
            ${match.a.note ? `<p class="note">${escapeHtml(match.a.note)}</p>` : ""}
            <span class="hint-pick">Tap to advance</span>
          </button>
          <div class="vs" aria-hidden="true">vs</div>
          <button type="button" class="name-pick" data-side="b" id="pick-b">
            <span class="name">${escapeHtml(match.b.name)}</span>
            ${match.b.note ? `<p class="note">${escapeHtml(match.b.note)}</p>` : ""}
            <span class="hint-pick">Tap to advance</span>
          </button>
        </div>
        <p class="kbd-hint">Keyboard: <kbd>1</kbd> / <kbd>←</kbd> left · <kbd>2</kbd> / <kbd>→</kbd> right</p>
      </section>
    `;

    document.getElementById("pick-a").addEventListener("click", () => pick("a"));
    document.getElementById("pick-b").addEventListener("click", () => pick("b"));
  }

  function renderChampion() {
    const champ = byId(state.championId);
    const top = ranking().slice(0, 4);
    app.innerHTML = `
      <section class="screen champion">
        <div class="trophy">Champion of the cup</div>
        <h2>${escapeHtml(champ?.name || "?")}</h2>
        <p>
          Survived every matchup. Run again anytime — each cup reshuffles —
          or copy the ranking for <code>baby-names.md</code>.
        </p>
        <div class="cta-row" style="justify-content:center">
          <button type="button" class="primary" id="btn-again">Play another cup</button>
          <button type="button" class="ghost" id="btn-open-standings">See ranking</button>
        </div>
        <div class="final-four">
          <h3>Final four (this cup)</h3>
          <ol>
            ${top.map((p) => `<li>${escapeHtml(p.name)}</li>`).join("")}
          </ol>
        </div>
      </section>
    `;
    document.getElementById("btn-again").addEventListener("click", startCup);
    document.getElementById("btn-open-standings").addEventListener("click", openStandings);
  }

  function render() {
    const showChrome = state.phase === "playing" || state.phase === "champion";
    btnStandings.hidden = !(showChrome || state.history.length);
    btnReset.hidden = state.phase === "home";

    if (state.phase === "home") renderHome();
    else if (state.phase === "playing") renderMatch();
    else renderChampion();
  }

  btnStandings.addEventListener("click", openStandings);
  btnReset.addEventListener("click", resetCup);
  btnExport.addEventListener("click", exportRanking);

  window.addEventListener("keydown", (e) => {
    if (state.phase !== "playing" || dialog.open) return;
    if (e.key === "1" || e.key === "ArrowLeft") {
      e.preventDefault();
      pick("a");
    } else if (e.key === "2" || e.key === "ArrowRight") {
      e.preventDefault();
      pick("b");
    }
  });

  // Resume mid-cup after reload
  if (state.phase !== "playing" && state.phase !== "champion") {
    state = homeState();
  }
  render();
})();
