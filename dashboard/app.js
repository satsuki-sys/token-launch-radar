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
  if (!D || !app) return;

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
    var html = '<div class="controls">' +
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
        sortHead('Peer price', 'blended_ratio', 'num hideS') + sortHead('Implied value', 'implied_value_usd', 'num') +
        '</tr></thead><tbody>';
      rows.forEach(function (r) {
        html += '<tr data-slug="' + esc(r.slug) + '"><td class="num">' + r.rank + '</td>' +
          '<td><span class="name">' + esc(r.name) + '</span>' + (r.on_watchlist ? ' <span class="star" title="On the snapshot watchlist">★</span>' : '') +
          '<div class="sub">' + esc(r.chains.slice(0, 3).join(' · ') || 'chain n/a') + '</div></td>' +
          '<td class="hideS">' + (r.category ? '<span class="pill">' + esc(r.category) + '</span>' : '<span class="sub">—</span>') + '</td>' +
          '<td class="num">' + usd(r.tvl_usd) + '</td>' +
          '<td class="num hideS ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg') + '">' + pct(r.change_7d) + '</td>' +
          '<td class="num hideS">' + ageLabel(r.age_days) + '</td>' +
          '<td class="num hideS">' + ratio(r.blended_ratio) + '</td>' +
          '<td class="num"><strong>' + usd(r.implied_value_usd) + '</strong><div class="bar"><i style="width:' + Math.max(2, Math.round(100 * r.implied_value_usd / maxImplied)) + '%"></i></div></td></tr>';
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
      '<div class="card"><div class="k">Running since</div><div class="v">' + ageLabel(r.age_days) + '</div><div class="s">tracked from ' + esc(r.listed_at || 'unknown') + '</div></div></div>' +
      '<section class="block"><h3>How this value is priced</h3>' +
      '<p>The price comes from the snapshot itself. Protocols in ' + esc(r.peer_category) + ' whose token already trades are worth a median of ' + ratio(r.peer_median_ratio) +
      ' of market cap per TVL dollar across ' + r.peer_count + ' peers; shrunk toward the market-wide median (' + ratio(D.global_median_ratio) + ') that gives the ' + ratio(r.blended_ratio) +
      ' this row is priced at. Its own record then tilts the price: seven-day TVL momentum ×' + r.growth_multiplier.toFixed(2) + ', and ' + ageLabel(r.age_days) +
      ' of running with no token ×' + r.maturity_multiplier.toFixed(2) + '.</p>' +
      '<p class="formula">implied = TVL ' + usd(r.tvl_usd) + ' × peer price ' + r.blended_ratio.toFixed(3) + ' × momentum ' + r.growth_multiplier.toFixed(2) + ' × maturity ' + r.maturity_multiplier.toFixed(2) + ' = ' + usd(r.implied_value_usd) + '</p></section>';
    if (peers.length) {
      html += '<section class="block"><h3>The peers behind the price</h3><table><thead><tr><th>Launched peer</th><th>Token</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Cap / TVL</th></tr></thead><tbody>' +
        peers.map(function (p) {
          return '<tr><td><span class="name">' + esc(p.name) + '</span></td><td>' + esc(p.symbol || '—') + '</td><td class="num">' + usd(p.tvl_usd) + '</td><td class="num">' + usd(p.mcap_usd) + '</td><td class="num">' + ratio(p.ratio) + '</td></tr>';
        }).join('') + '</tbody></table></section>';
    }
    html += '<section class="block"><h3>Farm plan</h3><ol class="plan">' +
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
      'The price used is the category median shrunk toward the market-wide median (' + ratio(D.global_median_ratio) + ') by peer count — (n × median + ' + c.shrink_k + ' × global) / (n + ' + c.shrink_k + '), capped to [' + c.ratio_floor + ', ' + c.ratio_cap + '] — ' +
      'so a two-peer category cannot set a wild price. Then the protocol\'s own record tilts it: seven-day TVL momentum, clamped to [' + c.growth_floor_pct + '%, +' + c.growth_cap_pct + '%], moves the price by up to ×' + (1 + c.growth_weight).toFixed(1) + '; ' +
      'and the longer it has run with no token, the less the launch is discounted, on a curve from ×' + c.maturity_base + ' toward ×' + (c.maturity_base + c.maturity_span).toFixed(2) + '.</p>' +
      '<p class="formula">implied value = TVL × shrunk peer price × momentum tilt × maturity tilt</p>' +
      '<p>The board ranks all ' + D.board_size + ' rankable pre-token protocols in the snapshot — every one of the ' + D.watchlist_size + ' watchlist protocols (TVL at or above ' + usd(D.floor_usd) + ') and the earlier finds below that floor. ' +
      'Wrapped, staked, bridged and versioned products of tokens that already trade are excluded by the same rule the house states for its watchlist; protocols whose token already trades are listed apart, at market value, and never ranked.</p></section>' +
      '<table><thead><tr><th>Category</th><th class="num">Launched peers</th><th class="num">Median cap/TVL</th><th class="num">Peer p25</th><th class="num">Peer p75</th><th class="num">Price used</th></tr></thead><tbody>' +
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
