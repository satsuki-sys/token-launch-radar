// Token Launch Radar — the dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders three views: the ranked pre-token board, the Already trading list that
// the prices come from, and the model itself, plus a detail view per protocol with its farm
// plan. No network: every byte it shows arrived in data.js.
(function () {
  'use strict';

  var D = window.RADAR;
  var app = document.getElementById('app');
  var meta = document.getElementById('meta');
  var tabs = document.getElementById('tabs');
  if (!app) return;
  if (!D) {
    app.innerHTML = '<div class="empty">The radar has no data to show: data.js, written beside this page by the entry program, did not load. Run the program first, then open the page it writes.</div>';
    app.setAttribute('aria-busy', 'false');
    return;
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function ageLabel(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + ' yrs';
    return days + ' days';
  }
  function ratio(n) { return n === null || n === undefined ? 'n/a' : n.toFixed(3) + 'x'; }

  meta.textContent = 'Snapshot ' + D.as_of + ' · ' + D.board_size + ' pre-token protocols ranked · ' +
    D.watchlist_size + ' on the watchlist · ' + D.live_size + ' already trading · model ' + D.model_version;

  var bySlug = {};
  D.rows.forEach(function (r) { bySlug[r.slug] = r; });
  var maxImplied = D.rows.length ? D.rows[0].implied_value_usd : 1;
  // The board-wide value span, for the per-row range bars (log scale: values span 4+ orders).
  var minLow = Infinity, maxHigh = 1;
  D.rows.forEach(function (r) {
    if (r.implied_low_usd < minLow) minLow = r.implied_low_usd;
    if (r.implied_high_usd > maxHigh) maxHigh = r.implied_high_usd;
  });
  if (!isFinite(minLow)) minLow = 1;
  var LOG_MIN = Math.log(Math.max(1, minLow)), LOG_SPAN = Math.max(1, Math.log(maxHigh) - LOG_MIN);
  function logPct(v) { return Math.min(100, Math.max(0, 100 * (Math.log(Math.max(1, v)) - LOG_MIN) / LOG_SPAN)); }
  function gradeWord(g) {
    return { A: 'deep peer evidence', B: 'solid peer evidence', C: 'fair peer evidence', D: 'thin peer evidence', E: 'market median only' }[g] || g;
  }
  function gradeBadge(r) {
    return '<span class="grade g' + r.evidence_grade + '" title="' + gradeWord(r.evidence_grade) + ': ' + r.peer_count +
      ' launched peers weighing ' + r.peer_weight.toFixed(2) + ' of this protocol\'s size">' + r.evidence_grade + '</span>';
  }
  function rangeBar(r) {
    var a = logPct(r.implied_low_usd), b = logPct(r.implied_high_usd), p = logPct(r.implied_value_usd);
    return '<div class="rangebar" title="Peer range ' + usd(r.implied_low_usd) + ' – ' + usd(r.implied_high_usd) + '">' +
      '<i class="band" style="left:' + a.toFixed(1) + '%;width:' + Math.max(1.5, b - a).toFixed(1) + '%"></i>' +
      '<i class="point" style="left:' + p.toFixed(1) + '%"></i></div>';
  }
  function momBar(n) {
    if (n === null || n === undefined) return '';
    var w = Math.min(50, Math.abs(n) / 25 * 50);
    var style = n >= 0 ? 'left:50%;width:' + w.toFixed(1) + '%' : 'left:' + (50 - w).toFixed(1) + '%;width:' + w.toFixed(1) + '%';
    return '<div class="mom ' + (n >= 0 ? 'up' : 'down') + '"><i style="' + style + '"></i></div>';
  }

  // --- routing: #/ board, #/live, #/model, #/p/<slug> detail, filters ride in #/?cat=..&q=..
  function route() {
    var h = location.hash.replace(/^#\/?/, '');
    var parts = h.split('?');
    var path = parts[0] || '';
    var params = {};
    (parts[1] || '').split('&').forEach(function (kv) {
      if (!kv) return;
      var at = kv.indexOf('=');
      params[decodeURIComponent(kv.slice(0, at))] = decodeURIComponent(kv.slice(at + 1));
    });
    return { path: path, params: params };
  }
  function setTab(view) {
    Array.prototype.forEach.call(tabs.querySelectorAll('.tab'), function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-view') === view);
    });
  }
  tabs.addEventListener('click', function (ev) {
    var b = ev.target.closest('.tab');
    if (!b) return;
    var v = b.getAttribute('data-view');
    location.hash = v === 'board' ? '#/' : '#/' + v;
  });

  var state = { q: '', cat: 'all', chain: 'all', watch: false, sort: 'rank', dir: 1 };

  function categories() {
    var seen = {};
    D.rows.forEach(function (r) { if (r.category) seen[r.category] = true; });
    return Object.keys(seen).sort();
  }
  function chains() {
    var seen = {};
    D.rows.forEach(function (r) { r.chains.forEach(function (c) { seen[c] = true; }); });
    return Object.keys(seen).sort();
  }

  function filtered() {
    var rows = D.rows.filter(function (r) {
      if (state.watch && !r.on_watchlist) return false;
      if (state.cat !== 'all' && r.category !== state.cat) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        if (r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      }
      return true;
    });
    var key = state.sort;
    rows.sort(function (a, b) {
      var va = key === 'name' ? a.name.toLowerCase() : a[key];
      var vb = key === 'name' ? b.name.toLowerCase() : b[key];
      if (va === null || va === undefined) va = -Infinity;
      if (vb === null || vb === undefined) vb = -Infinity;
      if (va < vb) return -state.dir;
      if (va > vb) return state.dir;
      return a.rank - b.rank;
    });
    return rows;
  }

  function sortHead(label, key, cls) {
    var arrow = state.sort === key ? (state.dir === 1 ? ' ↑' : ' ↓') : '';
    return '<th class="sortable ' + (cls || '') + '" data-sort="' + key + '">' + label + arrow + '</th>';
  }

  function renderBoard(params) {
    setTab('board');
    if (params.cat) state.cat = params.cat;
    if (params.q) state.q = params.q;
    if (params.chain) state.chain = params.chain;
    if (params.watch) state.watch = params.watch === '1';
    var rows = filtered();
    var combined = 0, strong = 0;
    D.rows.forEach(function (r) { combined += r.implied_value_usd; if (r.evidence_grade === 'A' || r.evidence_grade === 'B') strong++; });
    var html = '<div class="stats">' +
      '<div class="stat"><div class="k">Pre-token protocols ranked</div><div class="v">' + D.board_size + '</div><div class="s">every rankable protocol in the snapshot</div></div>' +
      '<div class="stat"><div class="k">Watchlist covered</div><div class="v">' + D.watchlist_size + ' / ' + D.watchlist_size + '</div><div class="s">the house floor at ' + usd(D.floor_usd) + ' TVL, all ranked</div></div>' +
      '<div class="stat"><div class="k">Combined implied value</div><div class="v">' + usd(combined) + '</div><div class="s">the board\'s own claim, summed over all rows</div></div>' +
      '<div class="stat"><div class="k">Priced on solid evidence</div><div class="v">' + strong + ' rows</div><div class="s">grade A or B peer weight · market median ' + ratio(D.global_median_ratio) + '</div></div></div>' +
      '<div class="controls">' +
      '<input type="search" id="q" placeholder="Search protocols" value="' + esc(state.q) + '">' +
      '<select id="cat"><option value="all">All categories</option>' +
      categories().map(function (c) { return '<option' + (state.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<select id="chain"><option value="all">All chains</option>' +
      chains().map(function (c) { return '<option' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<label class="check"><input type="checkbox" id="watch"' + (state.watch ? ' checked' : '') + '> Watchlist only (' + D.watchlist_size + ')</label>' +
      '<span class="count">' + rows.length + ' of ' + D.board_size + ' ranked · click a row for its farm plan</span></div>';
    if (rows.length === 0) {
      html += '<div class="empty">No protocol matches those filters. Loosen one and the radar sweeps again.</div>';
    } else {
      html += '<table><thead><tr>' +
        sortHead('#', 'rank', 'num') + sortHead('Protocol', 'name') + sortHead('Category', 'category', 'hideS') +
        sortHead('TVL', 'tvl_usd', 'num') + sortHead('7d', 'change_7d', 'num hideS') + sortHead('Age', 'age_days', 'num hideS') +
        sortHead('Peer price', 'blended_ratio', 'num hideS') + sortHead('Evidence', 'peer_weight', 'num hideS') + sortHead('Implied value', 'implied_value_usd', 'num') +
        '</tr></thead><tbody>';
      rows.forEach(function (r) {
        html += '<tr data-slug="' + esc(r.slug) + '"><td class="num">' + r.rank + '</td>' +
          '<td><span class="name">' + esc(r.name) + '</span>' + (r.on_watchlist ? ' <span class="star" title="On the snapshot watchlist">★</span>' : '') +
          '<div class="sub">' + esc(r.chains.slice(0, 3).join(' · ') || 'chain n/a') + '</div></td>' +
          '<td class="hideS">' + (r.category ? '<span class="pill">' + esc(r.category) + '</span>' : '<span class="sub">—</span>') + '</td>' +
          '<td class="num">' + usd(r.tvl_usd) + '</td>' +
          '<td class="num hideS ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg') + '">' + pct(r.change_7d) + momBar(r.change_7d) + '</td>' +
          '<td class="num hideS">' + ageLabel(r.age_days) + '</td>' +
          '<td class="num hideS">' + ratio(r.blended_ratio) + '</td>' +
          '<td class="num hideS">' + gradeBadge(r) + '</td>' +
          '<td class="num"><strong>' + usd(r.implied_value_usd) + '</strong>' + rangeBar(r) + '</td></tr>';
      });
      html += '</tbody></table>';
    }
    app.innerHTML = html;
    app.setAttribute('aria-busy', 'false');
    bindBoard();
  }

  function bindBoard() {
    var q = document.getElementById('q');
    if (q) q.addEventListener('input', function () { state.q = q.value; refreshTable(); });
    var cat = document.getElementById('cat');
    if (cat) cat.addEventListener('change', function () { state.cat = cat.value; refreshTable(); });
    var chain = document.getElementById('chain');
    if (chain) chain.addEventListener('change', function () { state.chain = chain.value; refreshTable(); });
    var watch = document.getElementById('watch');
    if (watch) watch.addEventListener('change', function () { state.watch = watch.checked; refreshTable(); });
    app.querySelectorAll('th.sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-sort');
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'name' || key === 'category' ? 1 : -1; }
        refreshTable();
      });
    });
    app.querySelectorAll('tbody tr').forEach(function (tr) {
      tr.addEventListener('click', function () { location.hash = '#/p/' + tr.getAttribute('data-slug'); });
    });
  }

  // Re-render only the table area on filter/sort changes, keeping the controls (and focus) intact.
  function refreshTable() {
    var keep = { q: state.q, cat: state.cat, chain: state.chain, watch: state.watch };
    renderBoard({});
    state.q = keep.q; state.cat = keep.cat; state.chain = keep.chain; state.watch = keep.watch;
    var q = document.getElementById('q');
    if (q && document.activeElement !== q && keep.q) { /* focus stays where the user left it */ }
  }

  // The 7d momentum gauge: the model's own clamp range, the protocol's mark on it, and the
  // multiplier that mark earns. One observation, drawn as a gauge — never as a history.
  function momentumGauge(r) {
    var c = D.constants;
    var lo = c.growth_floor_pct, hi = c.growth_cap_pct;
    if (r.change_7d === null) {
      return '<div class="gauge"><div class="glabel">7d TVL momentum</div><p class="sub">No seven-day change is reported for this protocol, so the model applies no momentum tilt (×1.00).</p></div>';
    }
    var clamped = Math.max(lo, Math.min(hi, r.change_7d));
    var at = 100 * (clamped - lo) / (hi - lo);
    var zero = 100 * (0 - lo) / (hi - lo);
    return '<div class="gauge"><div class="glabel">7d TVL momentum: ' + pct(r.change_7d) + ' → ×' + r.growth_multiplier.toFixed(2) + '</div>' +
      '<div class="gtrack"><i class="gzero" style="left:' + zero.toFixed(1) + '%"></i><i class="gmark" style="left:' + at.toFixed(1) + '%"></i></div>' +
      '<div class="gscale"><span>' + lo + '%</span><span>0</span><span>+' + hi + '%</span></div></div>';
  }

  // The peer strip: every shipped peer's cap/TVL as a dot on a log axis, the weighted median
  // as a tick and the price actually used as a diamond — the evidence, drawn.
  function peerStrip(r, peers) {
    if (!peers.length) return '';
    var vals = peers.map(function (p) { return p.ratio; }).concat([r.peer_median_ratio, r.blended_ratio]);
    var lo = Math.log(Math.min.apply(null, vals) * 0.8), hi = Math.log(Math.max.apply(null, vals) * 1.25);
    var span = Math.max(0.1, hi - lo);
    function x(v) { return (60 + 880 * (Math.log(Math.max(1e-4, v)) - lo) / span).toFixed(1); }
    var dots = peers.map(function (p) {
      return '<circle cx="' + x(p.ratio) + '" cy="30" r="7" class="dot"><title>' + esc(p.name) + ' — ' + ratio(p.ratio) + '</title></circle>';
    }).join('');
    return '<svg class="strip" viewBox="0 0 1000 84" role="img" aria-label="Peer price distribution">' +
      '<line x1="60" y1="30" x2="940" y2="30" class="axis"></line>' + dots +
      '<line x1="' + x(r.peer_median_ratio) + '" y1="12" x2="' + x(r.peer_median_ratio) + '" y2="48" class="med"></line>' +
      '<rect x="' + (x(r.blended_ratio) - 8) + '" y="22" width="16" height="16" transform="rotate(45 ' + x(r.blended_ratio) + ' 30)" class="used"></rect>' +
      '<text x="' + x(r.peer_median_ratio) + '" y="72" class="t med-t" text-anchor="middle">peer median ' + ratio(r.peer_median_ratio) + '</text>' +
      '<text x="' + x(r.blended_ratio) + '" y="72" class="t used-t" text-anchor="middle">price used ' + ratio(r.blended_ratio) + '</text>' +
      '</svg><p class="sub">Each dot is one of the largest launched ' + esc(r.peer_category) + ' peers, at its market cap per TVL dollar (log scale).</p>';
  }

  function splitStep(s) {
    var m = /^(.*) Cost: (.*)\. Time: (.*)\.$/.exec(s);
    if (!m) return { text: s, cost: '', time: '' };
    return { text: m[1], cost: m[2], time: m[3] };
  }

  function renderDetail(slug) {
    var r = bySlug[slug];
    if (!r) { renderBoard({}); return; }
    setTab('board');
    var peers = (D.peers[r.peer_category] || []);
    var html = '<p><a class="back" href="#/">← Back to the board</a></p>' +
      '<div class="detail-head"><div><h2>' + esc(r.name) + (r.on_watchlist ? ' <span class="star">★</span>' : '') + '</h2>' +
      '<p class="sub">' + esc(r.category || 'Uncategorized') + ' · ' + esc(r.chains.join(', ') || 'chain n/a') + ' · records no token · rank #' + r.rank + ' of ' + D.board_size + '</p></div></div>' +
      '<div class="cards">' +
      '<div class="card"><div class="k">Implied value</div><div class="v">' + usd(r.implied_value_usd) + '</div><div class="s">peer range ' + usd(r.implied_low_usd) + ' – ' + usd(r.implied_high_usd) + '</div></div>' +
      '<div class="card"><div class="k">TVL</div><div class="v">' + usd(r.tvl_usd) + '</div><div class="s">7d change ' + pct(r.change_7d) + '</div></div>' +
      '<div class="card"><div class="k">Peer price</div><div class="v">' + ratio(r.blended_ratio) + '</div><div class="s">' + r.peer_count + ' launched ' + esc(r.peer_category) + (r.peer_count === 1 ? ' peer' : ' peers') + ', median ' + ratio(r.peer_median_ratio) + '</div></div>' +
      '<div class="card"><div class="k">Evidence</div><div class="v">' + gradeBadge(r) + ' ' + r.peer_weight.toFixed(2) + '&times;</div><div class="s">' + gradeWord(r.evidence_grade) + ' — peers weighed against this protocol\'s own size</div></div>' +
      '<div class="card"><div class="k">Running since</div><div class="v">' + ageLabel(r.age_days) + '</div><div class="s">tracked from ' + esc(r.listed_at || 'unknown') + '</div></div></div>' +
      '<section class="block"><h3>How this value is priced</h3>' +
      '<p>The price comes from the snapshot itself. Protocols in ' + esc(r.peer_category) + ' whose token already trades are worth a size-weighted median of ' + ratio(r.peer_median_ratio) +
      ' of market cap per TVL dollar across ' + r.peer_count + ' peers; shrunk toward the market-wide median (' + ratio(D.global_median_ratio) + ') by the peer weight that gives the ' + ratio(r.blended_ratio) +
      ' this row is priced at. Its own record then tilts the price: seven-day TVL momentum ×' + r.growth_multiplier.toFixed(2) + ', and ' + ageLabel(r.age_days) +
      ' of running with no token ×' + r.maturity_multiplier.toFixed(2) + '.</p>' +
      '<p class="formula">implied = TVL ' + usd(r.tvl_usd) + ' × peer price ' + r.blended_ratio.toFixed(3) + ' × momentum ' + r.growth_multiplier.toFixed(2) + ' × maturity ' + r.maturity_multiplier.toFixed(2) + ' = ' + usd(r.implied_value_usd) + '</p>' +
      '<p>Each peer counts in proportion to its size next to this protocol: a peer at a hundredth of its TVL weighs 0.01, so the evidence behind this price sums to ' + r.peer_weight.toFixed(2) +
      ' full-size peers — grade ' + r.evidence_grade + ' (' + gradeWord(r.evidence_grade) + '). The range on the value, ' + usd(r.implied_low_usd) + ' – ' + usd(r.implied_high_usd) +
      ', is the peer set\'s own spread widened by the market\'s: the thinner the evidence, the wider the range the board prints.</p>' +
      momentumGauge(r) + '</section>';
    if (peers.length) {
      html += '<section class="block"><h3>The peers behind the price</h3>' + peerStrip(r, peers) + '<table><thead><tr><th>Launched peer</th><th>Token</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Cap / TVL</th></tr></thead><tbody>' +
        peers.map(function (p) {
          return '<tr><td><span class="name">' + esc(p.name) + '</span></td><td>' + esc(p.symbol || '—') + '</td><td class="num">' + usd(p.tvl_usd) + '</td><td class="num">' + usd(p.mcap_usd) + '</td><td class="num">' + ratio(p.ratio) + '</td></tr>';
        }).join('') + '</tbody></table></section>';
    }
    html += '<section class="block"><h3>Farm plan</h3>' +
      '<div class="chips plansum"><span class="chip">Capital: ' + usd(r.farm_capital_usd) + ' in the position</span>' +
      '<span class="chip time">Hold: ' + r.farm_days + ' days</span>' +
      '<span class="chip">' + r.farm_steps.length + ' steps</span>' +
      '<span class="chip time">First chain: ' + esc(r.chains[0] || 'its main chain') + '</span></div>' +
      '<ol class="plan">' +
      r.farm_steps.map(function (s) {
        var st = splitStep(s);
        return '<li><span class="step">' + esc(st.text) + '</span><span class="chips">' +
          (st.cost ? '<span class="chip">Cost: ' + esc(st.cost) + '</span>' : '') +
          (st.time ? '<span class="chip time">Time: ' + esc(st.time) + '</span>' : '') + '</span></li>';
      }).join('') + '</ol></section>';
    app.innerHTML = html;
    app.setAttribute('aria-busy', 'false');
  }

  function renderLive() {
    setTab('live');
    var html = '<section class="block"><h3>Already trading — the market these prices are read from</h3>' +
      '<p>These protocols\' tokens exist, so the radar never ranks them: it reads their market cap per TVL dollar as the peer evidence for pricing the pre-token board. ' +
      D.live_size + ' launched protocols are in the snapshot; the largest 60 are shown.</p></section>' +
      '<table><thead><tr><th>Protocol</th><th>Token</th><th class="hideS">Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Cap / TVL</th><th class="num hideS">7d</th></tr></thead><tbody>' +
      D.live.slice(0, 60).map(function (p) {
        return '<tr><td><span class="name">' + esc(p.name) + '</span></td><td>' + esc(p.symbol || '—') + '</td><td class="hideS">' + esc(p.category || '—') + '</td>' +
          '<td class="num">' + usd(p.tvl_usd) + '</td><td class="num">' + usd(p.mcap_usd) + '</td><td class="num">' + ratio(p.ratio) + '</td>' +
          '<td class="num hideS ' + (p.change_7d === null ? '' : p.change_7d >= 0 ? 'pos' : 'neg') + '">' + pct(p.change_7d) + '</td></tr>';
      }).join('') + '</tbody></table>';
    app.innerHTML = html;
    app.setAttribute('aria-busy', 'false');
  }

  function renderModel() {
    setTab('model');
    var c = D.constants;
    var html = '<section class="block"><h3>The model, in the open</h3>' +
      '<p>One function prices every row; no protocol name is special-cased. For a pre-token protocol: take the launched protocols in its DefiLlama category and their market cap per TVL dollar. ' +
      'Each peer counts in proportion to its size next to the protocol being priced — a peer at a hundredth of its TVL weighs 0.01 — and the price used is the size-weighted category median shrunk toward the market-wide median (' + ratio(D.global_median_ratio) + ') by the summed weight: (w × median + ' + c.shrink_k + ' × global) / (w + ' + c.shrink_k + '), capped to [' + c.ratio_floor + ', ' + c.ratio_cap + '] — ' +
      'so a small or lonely peer cannot set a large protocol\'s price. Every row carries an evidence grade read off that summed weight, A at eight full-size peers down to E where the market median is all there is, and its printed range widens as the evidence thins. Then the protocol\'s own record tilts the price: seven-day TVL momentum, clamped to [' + c.growth_floor_pct + '%, +' + c.growth_cap_pct + '%], moves it by up to ×' + (1 + c.growth_weight).toFixed(1) + '; ' +
      'and the longer it has run with no token, the less the launch is discounted, on a curve from ×' + c.maturity_base + ' toward ×' + (c.maturity_base + c.maturity_span).toFixed(2) + '.</p>' +
      '<p class="formula">implied value = TVL × shrunk peer price × momentum tilt × maturity tilt</p>' +
      '<p>The board ranks all ' + D.board_size + ' rankable pre-token protocols in the snapshot — every one of the ' + D.watchlist_size + ' watchlist protocols (TVL at or above ' + usd(D.floor_usd) + ') and the earlier finds below that floor. ' +
      'Wrapped, staked, bridged and versioned products of tokens that already trade are excluded by the same rule the house states for its watchlist; protocols whose token already trades are listed apart, at market value, and never ranked.</p></section>' +
      '<table><thead><tr><th>Category</th><th class="num">Launched peers</th><th class="num">Median cap/TVL</th><th class="num">Peer p25</th><th class="num">Peer p75</th><th class="num">Shrunk median</th></tr></thead><tbody>' +
      D.categories.map(function (s) {
        return '<tr><td><span class="name">' + esc(s.category) + '</span></td><td class="num">' + s.peers + '</td><td class="num">' + ratio(s.median_ratio) + '</td><td class="num">' + ratio(s.p25_ratio) + '</td><td class="num">' + ratio(s.p75_ratio) + '</td><td class="num"><strong>' + ratio(s.blended_ratio) + '</strong></td></tr>';
      }).join('') + '</tbody></table>';
    app.innerHTML = html;
    app.setAttribute('aria-busy', 'false');
  }

  function render() {
    var r = route();
    if (r.path === 'live') renderLive();
    else if (r.path === 'model') renderModel();
    else if (r.path.indexOf('p/') === 0) renderDetail(decodeURIComponent(r.path.slice(2)));
    else renderBoard(r.params);
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', render);
  render();
})();
