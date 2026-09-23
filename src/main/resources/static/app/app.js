/* FleetOS Command Center: single-page UI over the OpenFleet /api/v2 endpoints. */
(function () {
    'use strict';

    // Approximate coordinates by city. The legacy Location table stores addresses only (no geodata).
    var CITY_COORDS = {
        budapest: [47.4979, 19.0402], debrecen: [47.5316, 21.6273], vienna: [48.2082, 16.3738], wien: [48.2082, 16.3738],
        munich: [48.1351, 11.5820], 'münchen': [48.1351, 11.5820], milan: [45.4642, 9.1900], milano: [45.4642, 9.1900],
        rotterdam: [51.9244, 4.4777], nyiregyhaza: [47.9554, 21.7167], szeged: [46.2530, 20.1414], prague: [50.0755, 14.4378],
        berlin: [52.5200, 13.4050], hamburg: [53.5511, 9.9937], paris: [48.8566, 2.3522], warsaw: [52.2297, 21.0122]
    };
    var PALETTE = ['#3ee0b5', '#37a3ff', '#ffb547', '#c38bff', '#ff7a90', '#7be07b', '#ffd166', '#5fd4ff'];
    var DAY = 86400000;

    var state = {
        session: null, snap: null, idx: {}, route: 'command',
        replay: { t: 0, min: 0, max: 0, playing: false, speed: 1, raf: null, last: 0 },
        focusDriver: null, jobsQuery: '', jobsDriver: null, jobsSort: { key: 'start', dir: -1 },
        fleetKind: 'all', fleetDueOnly: false,
        payroll: null, payCurrency: 'EUR', payCache: {}
    };
    var map = null, mapLayers = null, truckMarkers = {};

    // ---------- utilities ----------
    function $(sel, root) { return (root || document).querySelector(sel); }
    function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
    function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
    function ts(iso) { return iso ? new Date(iso).getTime() : NaN; }
    function fmtDate(t, opts) { return new Date(t).toLocaleDateString('en-GB', opts || { day: 'numeric', month: 'short' }); }
    function fmtDateTime(t) { return new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
    function fmtNum(n) { return Number(n || 0).toLocaleString('en-US'); }
    function money(n, cur) {
        try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || 'EUR', maximumFractionDigits: 0 }).format(n || 0); }
        catch (e) { return fmtNum(n) + ' ' + (cur || ''); }
    }
    function initials(name) { return (name || '?').split(/\s+/).map(function (p) { return p[0]; }).join('').slice(0, 2).toUpperCase(); }
    function storage(key, val) {
        try { if (val === undefined) { return localStorage.getItem(key); } localStorage.setItem(key, val); } catch (e) { return null; }
        return null;
    }
    function toast(msg, kind) {
        var el = document.createElement('div');
        el.className = 'toast ' + (kind || 'ok');
        el.textContent = msg;
        $('#toasts').appendChild(el);
        setTimeout(function () { el.style.opacity = '0'; el.style.transition = '.3s'; }, 2600);
        setTimeout(function () { el.remove(); }, 3000);
    }
    function countUp(el, to, fmt) {
        var start = performance.now(), dur = 900;
        (function frame(now) {
            var p = Math.min(1, (now - start) / dur), eased = 1 - Math.pow(1 - p, 3);
            el.textContent = fmt(Math.round(to * eased));
            if (p < 1) { requestAnimationFrame(frame); }
        })(start);
    }
    function haversineKm(a, b) {
        var R = 6371, dLat = (b[0] - a[0]) * Math.PI / 180, dLon = (b[1] - a[1]) * Math.PI / 180;
        var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 2 * R * Math.asin(Math.sqrt(h));
    }

    // ---------- data ----------
    function api(url, opts) {
        return fetch(url, Object.assign({ credentials: 'same-origin', headers: { 'Accept': 'application/json' } }, opts || {}))
            .then(function (r) {
                var type = r.headers.get('content-type') || '';
                if (r.redirected && r.url.indexOf('/login') >= 0 || type.indexOf('text/html') >= 0 && url.indexOf('/api/') >= 0) {
                    window.location.href = '/login';
                    throw new Error('Session expired');
                }
                if (!r.ok) { throw new Error('Request failed: ' + r.status); }
                return type.indexOf('json') >= 0 ? r.json() : r.text();
            });
    }
    function coordsFor(loc, i) {
        var c = loc && CITY_COORDS[(loc.city || '').toLowerCase()];
        if (c) { return c; }
        // Unknown city: place it deterministically around central Europe so it still renders.
        var a = (loc ? loc.id : i) * 2.399;
        return [48.5 + Math.sin(a) * 2.5, 14 + Math.cos(a) * 5];
    }
    function index(snap) {
        var idx = { loc: {}, driver: {}, tractor: {}, trailer: {}, job: {}, color: {} };
        snap.locations.forEach(function (l, i) { l.coords = coordsFor(l, i); idx.loc[l.id] = l; });
        snap.drivers.forEach(function (d, i) { idx.driver[d.id] = d; idx.color[d.id] = PALETTE[i % PALETTE.length]; });
        snap.tractors.forEach(function (t) { idx.tractor[t.id] = t; });
        snap.trailers.forEach(function (t) { idx.trailer[t.id] = t; });
        snap.transports.forEach(function (j) {
            j.s = ts(j.start); j.f = ts(j.finish);
            j.from = idx.loc[j.fromId]; j.to = idx.loc[j.toId];
            j.km = j.from && j.to ? Math.round(haversineKm(j.from.coords, j.to.coords) * 1.25) : 0;
            idx.job[j.id] = j;
        });
        return idx;
    }
    function load() {
        return Promise.all([api('/api/v2/session'), api('/api/v2/snapshot')]).then(function (res) {
            state.session = res[0];
            state.snap = res[1];
            state.idx = index(state.snap);
            var jobs = state.snap.transports;
            if (jobs.length) {
                state.replay.min = Math.min.apply(null, jobs.map(function (j) { return j.s; })) - DAY;
                state.replay.max = Math.max.apply(null, jobs.map(function (j) { return j.f; })) + DAY;
                if (!state.replay.t) { state.replay.t = state.replay.min; }
            }
            $('#user-name').textContent = state.session.username || 'admin';
            $('#user-avatar').textContent = initials(state.session.username || 'A');
            $('#logout-csrf').name = state.session.csrfParameter || '_csrf';
            $('#logout-csrf').value = state.session.csrfToken || '';
            $('#nav-jobs').textContent = jobs.length;
            var due = state.snap.tractors.concat(state.snap.trailers).filter(function (v) { return v.inspectionAlert; }).length;
            $('#nav-fleet').textContent = due || '';
        });
    }
    function jobStatus(j) {
        var now = Date.now();
        if (now < j.s) { return { label: 'Scheduled', cls: 'muted' }; }
        if (now <= j.f) { return { label: 'In transit', cls: 'live' }; }
        return { label: 'Delivered', cls: 'ok' };
    }
    function jobCostSummary(j) {
        var byCur = {};
        (j.costs || []).forEach(function (c) { byCur[c.currency] = (byCur[c.currency] || 0) + c.amount; });
        return Object.keys(byCur).map(function (k) { return money(byCur[k], k); }).join(' + ') || '-';
    }
    function monthBounds(date) {
        var d = new Date(date);
        return { from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), to: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() };
    }

    // ---------- routing ----------
    var ROUTES = {
        command: { title: 'Command', sub: 'Live picture of your fleet. Press play to replay every trip.', render: renderCommand },
        jobs: { title: 'Jobs', sub: 'Every transport job, searchable and sortable', render: renderJobs },
        fleet: { title: 'Fleet', sub: 'Tractors and trailers, with inspection countdowns', render: renderFleet },
        payroll: { title: 'Payroll', sub: 'Driver payouts from the legacy payroll engine, in any currency', render: renderPayroll }
    };
    function go() {
        var name = (location.hash.replace(/^#\/?/, '') || 'command').split('?')[0];
        if (!ROUTES[name]) { name = 'command'; }
        state.route = name;
        stopReplay();
        if (map) { map.remove(); map = null; }
        $all('#nav a').forEach(function (a) { a.classList.toggle('active', a.getAttribute('data-route') === name); });
        $('#page-title').textContent = ROUTES[name].title;
        $('#page-sub').textContent = ROUTES[name].sub;
        var view = $('#view');
        view.style.animation = 'none'; void view.offsetWidth; view.style.animation = '';
        ROUTES[name].render(view);
    }

    // ---------- command center ----------
    function renderCommand(view) {
        var s = state.snap, idx = state.idx, today = ts(s.today);
        var mb = monthBounds(today);
        var monthJobs = s.transports.filter(function (j) { return j.f >= mb.from && j.f < mb.to; });
        var km = monthJobs.reduce(function (a, j) { return a + j.km; }, 0);
        var eur = 0;
        monthJobs.forEach(function (j) { (j.costs || []).forEach(function (c) { if (c.currency === 'EUR') { eur += c.amount; } }); });
        var alerts = s.tractors.concat(s.trailers).filter(function (v) { return v.inspectionAlert; })
            .sort(function (a, b) { return a.inspectionDaysRemaining - b.inspectionDaysRemaining; });

        view.innerHTML =
            '<div class="grid kpis">' +
            kpi('drivers', 'Active drivers', s.drivers.length, '', 'payroll') +
            kpi('tractors', 'Tractors', s.tractors.length, alerts.filter(function (v) { return v.kind === 'tractor'; }).length + ' due for inspection', 'fleet', true) +
            kpi('trailers', 'Trailers', s.trailers.length, alerts.filter(function (v) { return v.kind === 'trailer'; }).length + ' due for inspection', 'fleet', true) +
            kpi('jobs', 'Jobs this month', monthJobs.length, s.transports.length + ' all time', 'jobs') +
            kpi('km', 'Km this month', km, 'estimated road distance', 'jobs') +
            kpi('costs', 'Trip costs (EUR)', eur, 'this month', 'jobs') +
            '</div>' +
            '<div class="grid command-grid">' +
            '<div class="stack">' +
            '<div class="panel map-wrap"><div id="map"></div>' +
            '<div class="map-top" id="driver-chips"></div>' +
            '<div class="map-overlay">' +
            '<button class="play" id="play" title="Play / pause (space)"></button>' +
            '<div class="scrub"><div class="scrub-label"><span id="replay-status">Fleet replay</span><b id="replay-time" class="mono"></b></div>' +
            '<input type="range" id="scrubber" min="0" max="1000" step="1"/></div>' +
            '<div class="seg" id="speed"><button data-s="0.5">0.5×</button><button data-s="1" class="on">1×</button><button data-s="3">3×</button><button data-s="8">8×</button></div>' +
            '</div></div>' +
            '<div class="panel"><div class="panel-head"><h3>Driver timeline</h3><div class="legend"><span><i style="background:var(--warn)"></i>today</span><span>click a bar for details, drag to scrub</span></div></div>' +
            '<div class="panel-body"><svg class="timeline" id="timeline"></svg></div></div>' +
            '</div>' +
            '<div class="stack">' +
            '<div class="panel"><div class="panel-head"><h3>Inspections due</h3><span class="pill ' + (alerts.length ? 'warn' : 'ok') + '">' + alerts.length + '</span></div><div class="panel-body" id="alerts"></div></div>' +
            '<div class="panel"><div class="panel-head"><h3>Driver utilization</h3><span class="legend">' + fmtDate(today, { month: 'long' }) + '</span></div><div class="panel-body" id="util"></div></div>' +
            '<div class="panel"><div class="panel-head"><h3>Latest deliveries</h3></div><div class="panel-body history" id="latest"></div></div>' +
            '</div></div>';

        $all('.kpi', view).forEach(function (el) {
            el.addEventListener('click', function () { location.hash = '#/' + el.getAttribute('data-go'); });
            var v = el.querySelector('.value span'), n = Number(v.getAttribute('data-n'));
            countUp(v, n, el.getAttribute('data-k') === 'costs' ? function (x) { return money(x, 'EUR'); } : fmtNum);
        });

        $('#alerts').innerHTML = alerts.length ? alerts.map(function (v) {
            var d = v.inspectionDaysRemaining, pct = Math.max(0, Math.min(1, d / 30));
            var color = d <= 7 ? 'var(--danger)' : 'var(--warn)';
            return '<div class="alert" data-v="' + v.kind + ':' + v.id + '">' + ring(pct, color, 36) +
                '<div><strong>' + esc(v.plate) + ' · ' + esc(v.make) + '</strong><small>' + esc(v.kind) + ' · due ' + fmtDate(ts(v.inspectionDue), { day: 'numeric', month: 'short', year: 'numeric' }) + '</small></div>' +
                '<div class="days" style="color:' + color + '">' + d + '<small>days</small></div></div>';
        }).join('') : '<div class="empty">No inspections due in the next 30 days.</div>';
        $all('#alerts .alert').forEach(function (el) {
            el.addEventListener('click', function () { var p = el.getAttribute('data-v').split(':'); openVehicle(p[0], Number(p[1])); });
        });

        renderUtilization(today);
        var latest = s.transports.filter(function (j) { return j.f <= Date.now(); }).sort(function (a, b) { return b.f - a.f; }).slice(0, 5);
        $('#latest').innerHTML = latest.map(function (j) {
            return '<a href="javascript:void 0" data-job="' + j.id + '"><span class="dot" style="background:' + idx.color[j.driverId] + '"></span>' +
                esc(j.from ? j.from.city : '?') + ' → ' + esc(j.to ? j.to.city : '?') + '<small>' + fmtDate(j.f) + '</small></a>';
        }).join('') || '<div class="empty">No deliveries yet.</div>';
        bindJobLinks($('#latest'));

        renderChips();
        initMap();
        renderTimeline();
        initReplayControls();
        updateReplay();
        if (!state.autoplayed) { state.autoplayed = true; setTimeout(startReplay, 900); } // replay once per page load
    }
    function kpi(key, label, n, delta, goTo, warn) {
        var hasWarn = warn && /^[1-9]/.test(delta);
        return '<div class="panel kpi" data-k="' + key + '" data-go="' + goTo + '"><label>' + label + '</label>' +
            '<div class="value"><span data-n="' + n + '">0</span></div>' +
            '<div class="delta">' + (hasWarn ? '<b class="warn">' + esc(delta) + '</b>' : esc(delta)) + '</div></div>';
    }
    function ring(pct, color, size) {
        var r = size / 2 - 4, c = 2 * Math.PI * r;
        return '<svg class="ring" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" style="width:' + size + 'px;height:' + size + 'px">' +
            '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" stroke="var(--line-2)" stroke-width="4" fill="none"/>' +
            '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" stroke="' + color + '" stroke-width="4" fill="none" stroke-linecap="round" ' +
            'stroke-dasharray="' + c + '" stroke-dashoffset="' + (c * (1 - pct)) + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/></svg>';
    }
    function renderUtilization(today) {
        var mb = monthBounds(today), elapsed = Math.max(1, Math.round((Math.min(Date.now(), mb.to) - mb.from) / DAY));
        var rows = state.snap.drivers.map(function (d) {
            var days = {};
            state.snap.transports.forEach(function (j) {
                if (j.driverId !== d.id) { return; }
                for (var t = Math.max(j.s, mb.from); t <= Math.min(j.f, mb.to - 1); t += DAY) { days[new Date(t).toDateString()] = 1; }
                if (j.f >= mb.from && j.f < mb.to) { days[new Date(j.f).toDateString()] = 1; }
            });
            var n = Object.keys(days).length;
            return { d: d, pct: Math.min(100, Math.round(n / elapsed * 100)) };
        }).sort(function (a, b) { return b.pct - a.pct; });
        $('#util').innerHTML = rows.map(function (r) {
            return '<div class="util" data-driver="' + r.d.id + '"><span><i class="dot" style="display:inline-block;margin-right:6px;background:' + state.idx.color[r.d.id] + '"></i>' + esc(r.d.name) + '</span>' +
                '<div class="bar-track"><div class="bar-fill" style="width:0;background:' + state.idx.color[r.d.id] + '" data-w="' + r.pct + '"></div></div><b>' + r.pct + '%</b></div>';
        }).join('');
        requestAnimationFrame(function () { $all('#util .bar-fill').forEach(function (b) { b.style.width = b.getAttribute('data-w') + '%'; }); });
        $all('#util .util').forEach(function (el) {
            el.addEventListener('click', function () { openDriver(Number(el.getAttribute('data-driver'))); });
        });
    }
    function renderChips() {
        var html = '<button class="chip ' + (state.focusDriver ? '' : 'on') + '" data-d="">All drivers</button>' +
            state.snap.drivers.map(function (d) {
                var cls = state.focusDriver === d.id ? 'on' : (state.focusDriver ? 'dim' : '');
                return '<button class="chip ' + cls + '" data-d="' + d.id + '"><i style="background:' + state.idx.color[d.id] + '"></i>' + esc(d.name.split(' ')[0]) + '</button>';
            }).join('');
        $('#driver-chips').innerHTML = html;
        $all('#driver-chips .chip').forEach(function (c) {
            c.addEventListener('click', function () {
                var id = c.getAttribute('data-d');
                state.focusDriver = id ? (state.focusDriver === Number(id) ? null : Number(id)) : null;
                renderChips(); drawRoutes(); renderTimeline(); updateReplay();
            });
        });
    }

    // ---------- map ----------
    function tileUrl() {
        // Esri canvas basemaps: key-free, muted styling that lets the routes stand out.
        var dark = document.documentElement.getAttribute('data-theme') !== 'light';
        return 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/' + (dark ? 'World_Dark_Gray_Base' : 'World_Light_Gray_Base') + '/MapServer/tile/{z}/{y}/{x}';
    }
    function curve(a, b, n, bend) {
        // Quadratic Bezier between two lat/lng points, bent sideways so parallel routes stay readable.
        var mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dx = b[1] - a[1], dy = b[0] - a[0];
        var ctrl = [mid[0] + dx * (bend || 0.18), mid[1] - dy * (bend || 0.18)], pts = [];
        for (var i = 0; i <= n; i++) {
            var t = i / n, u = 1 - t;
            pts.push([u * u * a[0] + 2 * u * t * ctrl[0] + t * t * b[0], u * u * a[1] + 2 * u * t * ctrl[1] + t * t * b[1]]);
        }
        return pts;
    }
    function initMap() {
        map = L.map('map', { zoomControl: false, attributionControl: true, scrollWheelZoom: true }).setView([48.5, 13], 5);
        L.control.zoom({ position: 'topright' }).addTo(map);
        L.tileLayer(tileUrl(), { maxZoom: 16, attribution: 'Tiles &copy; Esri' }).addTo(map);
        mapLayers = { routes: L.layerGroup().addTo(map), cities: L.layerGroup().addTo(map), trucks: L.layerGroup().addTo(map) };
        truckMarkers = {};
        var usage = {};
        state.snap.transports.forEach(function (j) { usage[j.fromId] = (usage[j.fromId] || 0) + 1; usage[j.toId] = (usage[j.toId] || 0) + 1; });
        state.snap.locations.forEach(function (l) {
            L.marker(l.coords, { icon: L.divIcon({ className: '', html: '<div class="city-marker"></div>', iconSize: [12, 12], iconAnchor: [6, 6] }) })
                .bindTooltip('<b>' + esc(l.city) + '</b>, ' + esc(l.country) + '<br><span style="color:var(--muted)">' + (usage[l.id] || 0) + ' pickups & drops</span>', { direction: 'top', offset: [0, -8] })
                .addTo(mapLayers.cities);
        });
        drawRoutes();
        var pts = state.snap.locations.map(function (l) { return l.coords; });
        if (pts.length > 1) { map.fitBounds(pts, { padding: [60, 60] }); }
    }
    function drawRoutes() {
        if (!map) { return; }
        mapLayers.routes.clearLayers();
        state.snap.transports.forEach(function (j) {
            if (!j.from || !j.to) { return; }
            var focus = !state.focusDriver || state.focusDriver === j.driverId;
            var line = L.polyline(curve(j.from.coords, j.to.coords, 40, 0.14 + (j.id % 4) * 0.03), {
                color: state.idx.color[j.driverId], weight: focus ? 2.5 : 1, opacity: focus ? 0.55 : 0.08, dashArray: focus ? null : '4 6'
            }).addTo(mapLayers.routes);
            line.bindTooltip('<b>#' + j.id + ' ' + esc(j.cargo) + '</b><br>' + esc(j.from.city) + ' → ' + esc(j.to.city) + '<br>' + fmtDate(j.s) + ' – ' + fmtDate(j.f), { sticky: true });
            line.on('click', function () { openJob(j.id); });
            line.on('mouseover', function () { line.setStyle({ weight: 5, opacity: .95 }); });
            line.on('mouseout', function () { line.setStyle({ weight: focus ? 2.5 : 1, opacity: focus ? 0.55 : 0.08 }); });
        });
    }
    function driverPositionAt(driverId, t) {
        var jobs = state.snap.transports.filter(function (j) { return j.driverId === driverId && j.from && j.to; }).sort(function (a, b) { return a.s - b.s; });
        if (!jobs.length) { return null; }
        for (var i = 0; i < jobs.length; i++) {
            var j = jobs[i];
            if (t >= j.s && t <= j.f) {
                var p = (t - j.s) / (j.f - j.s), path = curve(j.from.coords, j.to.coords, 60, 0.14 + (j.id % 4) * 0.03);
                return { pos: path[Math.round(p * 60)], moving: true, job: j, progress: p };
            }
        }
        var before = jobs.filter(function (j) { return j.f < t; }).pop();
        if (before) { return { pos: before.to.coords, moving: false, job: before }; }
        return { pos: jobs[0].from.coords, moving: false, job: null };
    }
    function updateTrucks() {
        if (!map) { return; }
        var t = state.replay.t, moving = 0;
        state.snap.drivers.forEach(function (d) {
            var p = driverPositionAt(d.id, t);
            if (!p) { return; }
            if (p.moving) { moving++; }
            var dim = state.focusDriver && state.focusDriver !== d.id;
            var html = '<div class="truck-marker ' + (p.moving ? 'moving' : 'idle') + '" style="background:' + state.idx.color[d.id] + ';color:' + state.idx.color[d.id] + ';opacity:' + (dim ? .2 : '') + '">' +
                '<span style="color:#04130e">' + initials(d.name) + '</span></div>';
            var tip = '<b>' + esc(d.name) + '</b><br>' + (p.moving ? 'Hauling ' + esc(p.job.cargo) + ' to ' + esc(p.job.to.city) + ' · ' + Math.round(p.progress * 100) + '%' : 'Idle' + (p.job ? ' in ' + esc(p.job.to.city) : ''));
            var m = truckMarkers[d.id];
            if (!m) {
                m = L.marker(p.pos, { icon: L.divIcon({ className: '', html: html, iconSize: [30, 30], iconAnchor: [15, 15] }), zIndexOffset: 1000 }).addTo(mapLayers.trucks);
                m.on('click', function () { var cur = driverPositionAt(d.id, state.replay.t); if (cur && cur.job) { openJob(cur.job.id); } else { openDriver(d.id); } });
                m.bindTooltip(tip, { direction: 'top', offset: [0, -14] });
                truckMarkers[d.id] = m;
            } else {
                m.setLatLng(p.pos);
                m.setIcon(L.divIcon({ className: '', html: html, iconSize: [30, 30], iconAnchor: [15, 15] }));
                m.setTooltipContent(tip);
            }
        });
        var st = $('#replay-status');
        if (st) { st.textContent = moving ? moving + ' truck' + (moving > 1 ? 's' : '') + ' on the road' : 'All trucks parked'; }
    }

    // ---------- replay ----------
    function initReplayControls() {
        var sc = $('#scrubber');
        sc.addEventListener('input', function () {
            stopReplay();
            state.replay.t = state.replay.min + (state.replay.max - state.replay.min) * (sc.value / 1000);
            updateReplay();
        });
        $('#play').addEventListener('click', function () { state.replay.playing ? stopReplay() : startReplay(); });
        $all('#speed button').forEach(function (b) {
            b.addEventListener('click', function () {
                state.replay.speed = Number(b.getAttribute('data-s'));
                $all('#speed button').forEach(function (x) { x.classList.toggle('on', x === b); });
            });
        });
        setPlayIcon();
    }
    function setPlayIcon() {
        var b = $('#play');
        if (!b) { return; }
        b.innerHTML = state.replay.playing
            ? '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>'
            : '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>';
    }
    function startReplay() {
        if (state.route !== 'command' || !state.snap.transports.length) { return; }
        if (state.replay.t >= state.replay.max) { state.replay.t = state.replay.min; }
        state.replay.playing = true; state.replay.last = performance.now();
        setPlayIcon();
        (function tick(now) {
            if (!state.replay.playing) { return; }
            var dt = now - state.replay.last; state.replay.last = now;
            state.replay.t += dt / 1000 * DAY * state.replay.speed; // speed = simulated days per second
            if (state.replay.t >= state.replay.max) { state.replay.t = state.replay.max; stopReplay(); }
            updateReplay();
            state.replay.raf = requestAnimationFrame(tick);
        })(state.replay.last);
    }
    function stopReplay() {
        state.replay.playing = false;
        if (state.replay.raf) { cancelAnimationFrame(state.replay.raf); }
        setPlayIcon();
    }
    function updateReplay() {
        var r = state.replay, sc = $('#scrubber');
        if (!sc) { return; }
        sc.value = Math.round((r.t - r.min) / (r.max - r.min) * 1000);
        $('#replay-time').textContent = fmtDateTime(r.t);
        updateTrucks();
        var ph = $('#timeline .playhead');
        if (ph) { var x = timelineX(r.t); ph.setAttribute('x1', x); ph.setAttribute('x2', x); }
    }

    // ---------- timeline ----------
    var TL = { left: 120, right: 16, rowH: 34, top: 22 };
    function timelineX(t) {
        var svg = $('#timeline');
        if (!svg) { return 0; }
        var w = Number(svg.getAttribute('width')) || Math.max(400, svg.parentNode.clientWidth - 32), r = state.replay;
        return TL.left + (t - r.min) / (r.max - r.min) * (w - TL.left - TL.right);
    }
    function renderTimeline() {
        var svg = $('#timeline');
        if (!svg) { return; }
        var drivers = state.snap.drivers, w = Math.max(400, svg.parentNode.clientWidth - 32), r = state.replay;
        svg.setAttribute('width', w);
        var h = TL.top + drivers.length * TL.rowH + 8;
        svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
        svg.setAttribute('height', h);
        svg.style.width = w + 'px';
        svg.style.height = h + 'px';
        var parts = [];
        for (var t = new Date(r.min).setHours(0, 0, 0, 0); t <= r.max; t += DAY) {
            var d = new Date(t);
            if (d.getDate() === 1 || d.getDate() % 7 === 1) {
                var x = timelineX(t);
                parts.push('<line class="grid-line" x1="' + x + '" x2="' + x + '" y1="' + (TL.top - 6) + '" y2="' + h + '"/>');
                parts.push('<text class="tick" x="' + (x + 3) + '" y="12">' + fmtDate(t) + '</text>');
            }
        }
        drivers.forEach(function (dr, i) {
            var y = TL.top + i * TL.rowH, dim = state.focusDriver && state.focusDriver !== dr.id;
            parts.push('<text class="row-label" x="0" y="' + (y + 20) + '" opacity="' + (dim ? .4 : 1) + '">' + esc(dr.name) + '</text>');
            state.snap.transports.filter(function (j) { return j.driverId === dr.id; }).forEach(function (j) {
                var x1 = timelineX(j.s), x2 = Math.max(x1 + 4, timelineX(j.f));
                parts.push('<g class="bar" data-job="' + j.id + '" opacity="' + (dim ? .25 : 1) + '"><rect x="' + x1 + '" y="' + (y + 6) + '" width="' + (x2 - x1) + '" height="' + (TL.rowH - 12) + '" rx="6" fill="' + state.idx.color[dr.id] + '"/>' +
                    (x2 - x1 > 60 ? '<text class="bar-text" x="' + (x1 + 7) + '" y="' + (y + 21) + '">' + esc((j.to ? j.to.city : '')) + '</text>' : '') +
                    '<title>#' + j.id + ' ' + esc(j.cargo) + ': ' + esc(j.from ? j.from.city : '') + ' → ' + esc(j.to ? j.to.city : '') + '</title></g>');
            });
        });
        var tx = timelineX(ts(state.snap.today));
        parts.push('<line class="today" x1="' + tx + '" x2="' + tx + '" y1="' + (TL.top - 6) + '" y2="' + h + '"/>');
        var px = timelineX(r.t);
        parts.push('<line class="playhead" x1="' + px + '" x2="' + px + '" y1="' + (TL.top - 6) + '" y2="' + h + '"/>');
        svg.innerHTML = parts.join('');
        $all('.bar', svg).forEach(function (b) {
            b.addEventListener('click', function (e) { e.stopPropagation(); openJob(Number(b.getAttribute('data-job'))); });
        });
        var dragging = false;
        function scrubTo(e) {
            var rect = svg.getBoundingClientRect(), x = e.clientX - rect.left;
            var p = (x - TL.left) / (rect.width - TL.left - TL.right);
            if (p < 0 || p > 1) { return; }
            stopReplay();
            state.replay.t = r.min + p * (r.max - r.min);
            updateReplay();
        }
        svg.onmousedown = function (e) { if (e.target.closest('.bar')) { return; } dragging = true; scrubTo(e); };
        window.onmousemove = function (e) { if (dragging) { scrubTo(e); } };
        window.onmouseup = function () { dragging = false; };
    }

    // ---------- jobs ----------
    function renderJobs(view) {
        view.innerHTML = '<div class="toolbar"><label class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
            '<input id="job-q" placeholder="Search cargo, city, driver, plate, #id…" value="' + esc(state.jobsQuery) + '"/></label>' +
            '<div id="job-chips" style="display:flex;gap:6px;flex-wrap:wrap"></div></div>' +
            '<div class="panel"><table class="data" id="jobs-table"><thead></thead><tbody></tbody></table></div>';
        var q = $('#job-q');
        q.addEventListener('input', function () { state.jobsQuery = q.value; drawJobs(); });
        q.focus();
        drawJobChips(); drawJobs();
    }
    function drawJobChips() {
        $('#job-chips').innerHTML = '<button class="chip ' + (state.jobsDriver ? '' : 'on') + '" data-d="">All</button>' + state.snap.drivers.map(function (d) {
            return '<button class="chip ' + (state.jobsDriver === d.id ? 'on' : '') + '" data-d="' + d.id + '"><i style="background:' + state.idx.color[d.id] + '"></i>' + esc(d.name.split(' ')[0]) + '</button>';
        }).join('');
        $all('#job-chips .chip').forEach(function (c) {
            c.addEventListener('click', function () { var v = c.getAttribute('data-d'); state.jobsDriver = v ? Number(v) : null; drawJobChips(); drawJobs(); });
        });
    }
    var JOB_COLS = [
        { key: 'id', label: '#', val: function (j) { return j.id; } },
        { key: 'route', label: 'Route', val: function (j) { return (j.from ? j.from.city : '') + (j.to ? j.to.city : ''); } },
        { key: 'driver', label: 'Driver', val: function (j) { var d = state.idx.driver[j.driverId]; return d ? d.name : ''; } },
        { key: 'cargo', label: 'Cargo', val: function (j) { return j.cargo; } },
        { key: 'weight', label: 'Weight', num: true, val: function (j) { return j.cargoWeight; } },
        { key: 'km', label: 'Km (est.)', num: true, val: function (j) { return j.km; } },
        { key: 'start', label: 'Departed', val: function (j) { return j.s; } },
        { key: 'finish', label: 'Delivered', val: function (j) { return j.f; } },
        { key: 'costs', label: 'Costs', num: true, val: function (j) { return (j.costs || []).length; } },
        { key: 'status', label: 'Status', val: function (j) { return jobStatus(j).label; } }
    ];
    function drawJobs() {
        var q = state.jobsQuery.trim().toLowerCase(), idx = state.idx, srt = state.jobsSort;
        var rows = state.snap.transports.filter(function (j) {
            if (state.jobsDriver && j.driverId !== state.jobsDriver) { return false; }
            if (!q) { return true; }
            var d = idx.driver[j.driverId], tr = idx.tractor[j.tractorId], tl = idx.trailer[j.trailerId];
            return [('#' + j.id), j.cargo, j.from && j.from.city, j.to && j.to.city, d && d.name, tr && tr.plate, tl && tl.plate].join(' ').toLowerCase().indexOf(q) >= 0;
        });
        var col = JOB_COLS.filter(function (c) { return c.key === srt.key; })[0];
        rows.sort(function (a, b) { var x = col.val(a), y = col.val(b); return (x > y ? 1 : x < y ? -1 : 0) * srt.dir; });
        $('#jobs-table thead').innerHTML = '<tr>' + JOB_COLS.map(function (c) {
            return '<th data-k="' + c.key + '" class="' + (c.num ? 'num' : '') + '">' + c.label + (srt.key === c.key ? '<span class="sort">' + (srt.dir > 0 ? '▲' : '▼') + '</span>' : '') + '</th>';
        }).join('') + '</tr>';
        $all('#jobs-table th').forEach(function (th) {
            th.addEventListener('click', function () {
                var k = th.getAttribute('data-k');
                state.jobsSort = { key: k, dir: srt.key === k ? -srt.dir : 1 };
                drawJobs();
            });
        });
        $('#jobs-table tbody').innerHTML = rows.map(function (j) {
            var d = idx.driver[j.driverId], st = jobStatus(j);
            return '<tr data-job="' + j.id + '"><td class="mono">#' + j.id + '</td>' +
                '<td><span class="route">' + esc(j.from ? j.from.city : '?') + '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>' + esc(j.to ? j.to.city : '?') + '</span></td>' +
                '<td><span class="who"><span class="dot" style="background:' + idx.color[j.driverId] + '"></span>' + esc(d ? d.name : '-') + '</span></td>' +
                '<td>' + esc(j.cargo) + ' <span style="color:var(--muted)">×' + fmtNum(j.cargoCount) + '</span></td>' +
                '<td class="num">' + fmtNum(j.cargoWeight) + ' kg</td><td class="num">' + fmtNum(j.km) + '</td>' +
                '<td>' + fmtDateTime(j.s) + '</td><td>' + fmtDateTime(j.f) + '</td>' +
                '<td class="num">' + jobCostSummary(j) + '</td><td><span class="pill ' + st.cls + '">' + st.label + '</span></td></tr>';
        }).join('') || '<tr><td colspan="10" class="empty" style="text-align:center;padding:30px">No jobs match “' + esc(state.jobsQuery) + '”.</td></tr>';
        $all('#jobs-table tbody tr[data-job]').forEach(function (tr) {
            tr.addEventListener('click', function () { openJob(Number(tr.getAttribute('data-job'))); });
        });
    }

    // ---------- fleet ----------
    function renderFleet(view) {
        view.innerHTML = '<div class="toolbar"><div class="seg" id="fleet-kind">' +
            ['all', 'tractor', 'trailer'].map(function (k) { return '<button data-k="' + k + '" class="' + (state.fleetKind === k ? 'on' : '') + '">' + (k === 'all' ? 'All vehicles' : k.charAt(0).toUpperCase() + k.slice(1) + 's') + '</button>'; }).join('') +
            '</div><button class="chip ' + (state.fleetDueOnly ? 'on' : '') + '" id="due-only"><i style="background:var(--warn)"></i>Inspection due ≤ 30 days</button></div>' +
            '<div class="grid cards" id="fleet-cards"></div>';
        $all('#fleet-kind button').forEach(function (b) {
            b.addEventListener('click', function () { state.fleetKind = b.getAttribute('data-k'); renderFleet(view); });
        });
        $('#due-only').addEventListener('click', function () { state.fleetDueOnly = !state.fleetDueOnly; renderFleet(view); });
        var since = ts(state.snap.today) - 60 * DAY;
        var list = state.snap.tractors.concat(state.snap.trailers).filter(function (v) {
            return (state.fleetKind === 'all' || v.kind === state.fleetKind) && (!state.fleetDueOnly || v.inspectionAlert);
        }).sort(function (a, b) { return a.inspectionDaysRemaining - b.inspectionDaysRemaining; });
        $('#fleet-cards').innerHTML = list.map(function (v) {
            var jobs = state.snap.transports.filter(function (j) { return (v.kind === 'tractor' ? j.tractorId : j.trailerId) === v.id; });
            var recent = jobs.filter(function (j) { return j.f >= since; });
            var km = recent.reduce(function (a, j) { return a + j.km; }, 0);
            var d = v.inspectionDaysRemaining, color = d <= 7 ? 'var(--danger)' : d <= 30 ? 'var(--warn)' : 'var(--ok)';
            return '<div class="panel vcard" data-v="' + v.kind + ':' + v.id + '"><header><div><span class="plate">' + esc(v.plate) + '</span>' +
                '<h4>' + esc(v.make) + ' ' + esc(v.model) + '</h4><p>' + esc(v.kind) + ' · built ' + (v.built ? v.built.slice(0, 4) : '-') + '</p></div>' +
                '<div style="text-align:center">' + ring(Math.max(0, Math.min(1, d / 365)), color, 54) + '<div style="font-size:11px;color:' + color + ';font-weight:700;margin-top:-2px">' + d + ' d</div></div></header>' +
                '<div class="stats"><div><b>' + recent.length + '</b>jobs · 60d</div><div><b>' + fmtNum(km) + '</b>km · 60d</div><div><b>' + fmtNum(v.maxWeight / 1000) + ' t</b>capacity</div></div></div>';
        }).join('') || '<div class="empty">No vehicles match these filters.</div>';
        $all('#fleet-cards .vcard').forEach(function (el) {
            el.addEventListener('click', function () { var p = el.getAttribute('data-v').split(':'); openVehicle(p[0], Number(p[1])); });
        });
    }

    // ---------- payroll ----------
    function renderPayroll(view) {
        if (!state.payroll) {
            var t = new Date(ts(state.snap.today));
            var prev = new Date(t.getFullYear(), t.getMonth() - 1, 1);
            state.payroll = { y: prev.getFullYear(), m: prev.getMonth() }; // last closed month (month index 0-11)
        }
        var label = new Date(state.payroll.y, state.payroll.m, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
        view.innerHTML = '<div class="toolbar"><div class="month-nav"><button class="icon-btn" id="pm-prev" title="Previous month"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>' +
            '<strong>' + label + '</strong><button class="icon-btn" id="pm-next" title="Next month"><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></button></div>' +
            '<div class="seg" id="pay-cur">' + ['EUR', 'HUF', 'USD'].map(function (c) { return '<button data-c="' + c + '" class="' + (state.payCurrency === c ? 'on' : '') + '">' + c + '</button>'; }).join('') + '</div>' +
            '<span class="legend" style="margin-left:auto"><span><i style="background:var(--accent)"></i>work days</span><span><i style="background:var(--line-2)"></i>rest days</span></span></div>' +
            '<div class="grid payroll-grid" id="pay-kpis">' + ['Total payroll', 'Billed work days', 'Average per driver'].map(function (l) {
                return '<div class="panel kpi"><label>' + l + '</label><div class="value" style="color:var(--faint)">…</div><div class="delta">' +
                    (state.payCurrency === 'EUR' ? 'Running payroll engine' : 'Fetching live ' + state.payCurrency + ' rate from the Hungarian National Bank') + '</div></div>';
            }).join('') + '</div><div class="panel"><table class="data" id="pay-table"><thead><tr><th>Driver</th><th>Work vs rest</th><th class="num">Work days</th><th class="num">Rest days</th><th class="num">Jobs billed</th><th class="num">Payout</th></tr></thead><tbody><tr><td colspan="6" class="empty" style="text-align:center;padding:30px">Running payroll…</td></tr></tbody></table></div>';
        $('#pm-prev').onclick = function () { shiftMonth(-1); };
        $('#pm-next').onclick = function () { shiftMonth(1); };
        $all('#pay-cur button').forEach(function (b) { b.onclick = function () { state.payCurrency = b.getAttribute('data-c'); renderPayroll(view); }; });
        var key = state.payroll.y + '-' + (state.payroll.m + 1) + '-' + state.payCurrency;
        var p = state.payCache[key] ? Promise.resolve(state.payCache[key])
            : api('/api/v2/payouts?year=' + state.payroll.y + '&month=' + (state.payroll.m + 1) + '&currency=' + state.payCurrency).then(function (d) { state.payCache[key] = d; return d; });
        p.then(function (data) {
            if (state.route !== 'payroll') { return; }
            drawPayroll(data);
        }).catch(function (e) {
            $('#pay-table tbody').innerHTML = '<tr><td colspan="6" class="empty" style="text-align:center;padding:30px">Payroll failed: ' + esc(e.message) + (state.payCurrency !== 'EUR' ? '. The currency rate comes from the MNB service, which may be unreachable.' : '') + '</td></tr>';
        });
        function shiftMonth(n) { var d = new Date(state.payroll.y, state.payroll.m + n, 1); state.payroll = { y: d.getFullYear(), m: d.getMonth() }; renderPayroll(view); }
    }
    function drawPayroll(data) {
        var rows = data.rows, cur = data.currency;
        var total = rows.reduce(function (a, r) { return a + r.amount; }, 0), work = rows.reduce(function (a, r) { return a + r.workDays; }, 0);
        $('#pay-kpis').innerHTML =
            '<div class="panel kpi"><label>Total payroll</label><div class="value"><span id="pay-total">0</span></div><div class="delta">' + rows.length + ' drivers paid</div></div>' +
            '<div class="panel kpi"><label>Billed work days</label><div class="value"><span id="pay-work">0</span></div><div class="delta">50 EUR per work day (legacy rate)</div></div>' +
            '<div class="panel kpi"><label>Average per driver</label><div class="value"><span id="pay-avg">0</span></div><div class="delta">' + esc(cur) + '</div></div>';
        countUp($('#pay-total'), total, function (x) { return money(x, cur); });
        countUp($('#pay-work'), work, fmtNum);
        countUp($('#pay-avg'), rows.length ? Math.round(total / rows.length) : 0, function (x) { return money(x, cur); });
        $('#pay-table tbody').innerHTML = rows.map(function (r) {
            var tot = Math.max(1, r.workDays + r.restDays), color = state.idx.color[r.driverId];
            return '<tr data-driver="' + r.driverId + '"><td><span class="who"><span class="avatar" style="width:28px;height:28px;font-size:11px;background:' + color + '">' + initials(r.driverName) + '</span>' + esc(r.driverName) + '</span></td>' +
                '<td><div class="stacked"><i style="width:0;background:' + color + '" data-w="' + (r.workDays / tot * 100) + '"></i><i style="width:0;background:var(--line-2)" data-w="' + (r.restDays / tot * 100) + '"></i></div></td>' +
                '<td class="num">' + r.workDays + '</td><td class="num">' + r.restDays + '</td><td class="num">' + r.transportIds.length + '</td><td class="num money">' + money(r.amount, r.currency) + '</td></tr>';
        }).join('') || '<tr><td colspan="6" class="empty" style="text-align:center;padding:30px">No completed transports in this month, so there is nothing to pay.</td></tr>';
        requestAnimationFrame(function () { $all('#pay-table .stacked i').forEach(function (i) { i.style.width = i.getAttribute('data-w') + '%'; }); });
        $all('#pay-table tbody tr[data-driver]').forEach(function (tr) {
            tr.addEventListener('click', function () {
                var row = rows.filter(function (r) { return r.driverId === Number(tr.getAttribute('data-driver')); })[0];
                openPayout(row);
            });
        });
    }

    // ---------- drawers ----------
    function openDrawer(html, after) {
        $('#drawer-body').innerHTML = html;
        document.body.classList.add('drawer-open');
        $('#drawer').setAttribute('aria-hidden', 'false');
        if (after) { setTimeout(after, 320); }
    }
    function closeDrawer() {
        document.body.classList.remove('drawer-open');
        $('#drawer').setAttribute('aria-hidden', 'true');
    }
    function bindJobLinks(root) {
        $all('[data-job]', root).forEach(function (a) { a.addEventListener('click', function () { openJob(Number(a.getAttribute('data-job'))); }); });
    }
    function openJob(id) {
        var j = state.idx.job[id];
        if (!j) { return; }
        var d = state.idx.driver[j.driverId], tr = state.idx.tractor[j.tractorId], tl = state.idx.trailer[j.trailerId], st = jobStatus(j);
        var hours = Math.round((j.f - j.s) / 3600000);
        openDrawer(
            '<div class="drawer-hero"><div class="eyebrow">Job #' + j.id + ' · <span class="pill ' + st.cls + '">' + st.label + '</span></div>' +
            '<h2>' + esc(j.from ? j.from.city : '?') + ' → ' + esc(j.to ? j.to.city : '?') + '</h2><p>' + esc(j.cargo) + ' · ' + fmtNum(j.cargoCount) + ' units · ' + fmtNum(j.cargoWeight) + ' kg</p></div>' +
            '<div class="drawer-section"><div class="mini-map-wrap"><div class="mini-map" id="mini-map"></div></div></div>' +
            '<div class="drawer-section"><div class="kv">' +
            '<div><small>Driver</small><b><a href="javascript:void 0" id="dj-driver">' + esc(d ? d.name : '-') + '</a></b></div>' +
            '<div><small>Distance (est.)</small><b>' + fmtNum(j.km) + ' km · ' + hours + ' h</b></div>' +
            '<div><small>Tractor</small><b><a href="javascript:void 0" id="dj-tractor">' + esc(tr ? tr.plate + ' ' + tr.make : '-') + '</a></b></div>' +
            '<div><small>Trailer</small><b><a href="javascript:void 0" id="dj-trailer">' + esc(tl ? tl.plate + ' ' + tl.make : '-') + '</a></b></div>' +
            '<div><small>Loaded</small><b>' + fmtDateTime(ts(j.loadedAt)) + '</b></div>' +
            '<div><small>Unloaded</small><b>' + fmtDateTime(ts(j.unloadedAt)) + '</b></div>' +
            '<div><small>Pickup</small><b>' + esc(j.from ? j.from.address : '-') + '</b></div>' +
            '<div><small>Drop-off</small><b>' + esc(j.to ? j.to.address : '-') + '</b></div></div></div>' +
            '<div class="drawer-section"><h4>Trip costs' + ((j.costs || []).length ? ' · ' + jobCostSummary(j) : '') + '</h4><div id="cost-list">' +
            ((j.costs || []).map(function (c) {
                return '<div class="cost-row"><span>' + esc(c.description) + '<br><small>' + (c.date ? fmtDate(ts(c.date), { day: 'numeric', month: 'short', year: 'numeric' }) : '') + '</small></span>' +
                    '<b class="money">' + money(c.amount, c.currency) + '</b><button class="link-danger" data-cost="' + c.id + '" title="Remove cost"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></button></div>';
            }).join('') || '<div class="empty">No costs recorded.</div>') + '</div>' +
            '<form id="cost-form"><div class="form-row"><input class="field" name="costDescription" placeholder="e.g. Diesel refuel Vienna" required/>' +
            '<input class="field" name="amount" type="number" min="1" placeholder="Amount" required/>' +
            '<select class="field" name="currency"><option>EUR</option><option>HUF</option><option>USD</option></select></div>' +
            '<div class="form-row"><input class="field" name="date" type="date" required value="' + new Date(j.f).toISOString().slice(0, 10) + '"/>' +
            '<button class="btn primary" type="submit"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Add cost</button></div></form></div>',
            function () {
                if (!j.from || !j.to) { return; }
                var mm = L.map('mini-map', { zoomControl: false, attributionControl: false, dragging: true, scrollWheelZoom: false });
                L.tileLayer(tileUrl(), { maxZoom: 16 }).addTo(mm);
                var path = curve(j.from.coords, j.to.coords, 50, 0.18);
                L.polyline(path, { color: state.idx.color[j.driverId], weight: 4 }).addTo(mm);
                [j.from, j.to].forEach(function (l, i) {
                    L.circleMarker(l.coords, { radius: 7, color: '#fff', weight: 2, fillColor: i ? '#ff5d73' : '#3ee0b5', fillOpacity: 1 }).bindTooltip(esc(l.city), { permanent: true, direction: i ? 'right' : 'left' }).addTo(mm);
                });
                mm.fitBounds(path, { padding: [40, 40] });
            });
        $('#dj-driver').onclick = function () { if (d) { openDriver(d.id); } };
        $('#dj-tractor').onclick = function () { if (tr) { openVehicle('tractor', tr.id); } };
        $('#dj-trailer').onclick = function () { if (tl) { openVehicle('trailer', tl.id); } };
        $('#cost-form').addEventListener('submit', function (e) {
            e.preventDefault();
            var f = e.target, btn = f.querySelector('button'), body = new URLSearchParams(new FormData(f));
            body.set('transportId', j.id);
            body.set(state.session.csrfParameter || '_csrf', state.session.csrfToken);
            btn.disabled = true;
            fetch('/transport/job/addCost', { method: 'POST', credentials: 'same-origin', body: body })
                .then(function (r) { if (!r.ok) { throw new Error('HTTP ' + r.status); } return refresh(); })
                .then(function () { toast('Cost added to job #' + j.id); openJob(j.id); })
                .catch(function (err) { btn.disabled = false; toast('Could not add cost: ' + err.message, 'err'); });
        });
        $all('#cost-list [data-cost]').forEach(function (b) {
            b.addEventListener('click', function () {
                if (!window.confirm('Remove this cost from job #' + j.id + '?')) { return; }
                fetch('/transport/job/deleteCost?id=' + b.getAttribute('data-cost') + '&transportId=' + j.id, { credentials: 'same-origin' })
                    .then(function (r) { if (!r.ok) { throw new Error('HTTP ' + r.status); } return refresh(); })
                    .then(function () { toast('Cost removed'); openJob(j.id); })
                    .catch(function (err) { toast('Could not remove cost: ' + err.message, 'err'); });
            });
        });
    }
    function openDriver(id) {
        var d = state.idx.driver[id];
        if (!d) { return; }
        var jobs = state.snap.transports.filter(function (j) { return j.driverId === id; }).sort(function (a, b) { return b.s - a.s; });
        var km = jobs.reduce(function (a, j) { return a + j.km; }, 0);
        openDrawer('<div class="drawer-hero"><div class="eyebrow">Driver</div><h2><span class="dot" style="display:inline-block;margin-right:8px;background:' + state.idx.color[id] + '"></span>' + esc(d.name) + '</h2>' +
            '<p>Based in ' + esc(d.homeCity || '-') + ' · employed since ' + (d.employedSince ? fmtDate(ts(d.employedSince), { month: 'short', year: 'numeric' }) : '-') + '</p></div>' +
            '<div class="drawer-section"><div class="kv"><div><small>Jobs</small><b>' + jobs.length + '</b></div><div><small>Distance (est.)</small><b>' + fmtNum(km) + ' km</b></div></div></div>' +
            '<div class="drawer-section"><h4>Jobs</h4><div class="history">' + jobs.map(function (j) {
                return '<a href="javascript:void 0" data-job="' + j.id + '">#' + j.id + ' ' + esc(j.from ? j.from.city : '') + ' → ' + esc(j.to ? j.to.city : '') + '<small>' + fmtDate(j.s) + ' – ' + fmtDate(j.f) + '</small></a>';
            }).join('') + '</div></div>' +
            '<div class="drawer-section"><button class="btn" id="focus-driver"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>Follow on map</button></div>');
        bindJobLinks($('#drawer-body'));
        $('#focus-driver').onclick = function () { state.focusDriver = id; closeDrawer(); if (state.route === 'command') { renderChips(); drawRoutes(); renderTimeline(); updateReplay(); } else { location.hash = '#/command'; } };
    }
    function openVehicle(kind, id) {
        var v = (kind === 'tractor' ? state.idx.tractor : state.idx.trailer)[id];
        if (!v) { return; }
        var jobs = state.snap.transports.filter(function (j) { return (kind === 'tractor' ? j.tractorId : j.trailerId) === id; }).sort(function (a, b) { return b.s - a.s; });
        var d = v.inspectionDaysRemaining, color = d <= 7 ? 'var(--danger)' : d <= 30 ? 'var(--warn)' : 'var(--ok)';
        openDrawer('<div class="drawer-hero"><div class="eyebrow">' + esc(kind) + ' · <span class="plate">' + esc(v.plate) + '</span></div><h2>' + esc(v.make) + ' ' + esc(v.model) + '</h2><p>VIN ' + esc(v.vin) + '</p></div>' +
            '<div class="drawer-section" style="display:flex;align-items:center;gap:16px">' + ring(Math.max(0, Math.min(1, d / 365)), color, 72) +
            '<div><div style="font-size:26px;font-weight:800;color:' + color + '">' + d + ' days</div><div style="color:var(--muted)">until inspection on ' + fmtDate(ts(v.inspectionDue), { day: 'numeric', month: 'long', year: 'numeric' }) + '</div></div></div>' +
            '<div class="drawer-section"><div class="kv"><div><small>Built</small><b>' + esc(v.built || '-') + '</b></div><div><small>Own weight</small><b>' + fmtNum(v.weight) + ' kg</b></div>' +
            '<div><small>Max load</small><b>' + fmtNum(v.maxWeight) + ' kg</b></div>' + (v.fuelNorm ? '<div><small>Fuel norm</small><b>' + v.fuelNorm + ' l/100km</b></div>' : '') + '</div></div>' +
            '<div class="drawer-section"><h4>Job history · ' + jobs.length + '</h4><div class="history">' + (jobs.map(function (j) {
                var dr = state.idx.driver[j.driverId];
                return '<a href="javascript:void 0" data-job="' + j.id + '"><span class="dot" style="background:' + state.idx.color[j.driverId] + '"></span>#' + j.id + ' ' + esc(j.from ? j.from.city : '') + ' → ' + esc(j.to ? j.to.city : '') + '<small>' + esc(dr ? dr.name.split(' ')[0] : '') + ' · ' + fmtDate(j.s) + '</small></a>';
            }).join('') || '<div class="empty">No jobs yet.</div>') + '</div></div>');
        bindJobLinks($('#drawer-body'));
    }
    function openPayout(row) {
        var y = state.payroll.y, m = state.payroll.m, first = new Date(y, m, 1), days = new Date(y, m + 1, 0).getDate();
        var worked = {}, jobs = row.transportIds.map(function (id) { return state.idx.job[id]; }).filter(Boolean);
        jobs.forEach(function (j) { for (var t = new Date(j.s).setHours(0, 0, 0, 0); t <= j.f; t += DAY) { worked[new Date(t).toDateString()] = j; } });
        var color = state.idx.color[row.driverId], cells = [];
        ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].forEach(function (d) { cells.push('<div class="dow">' + d + '</div>'); });
        for (var i = 0; i < (first.getDay() + 6) % 7; i++) { cells.push('<div class="day out"></div>'); }
        for (var dd = 1; dd <= days; dd++) {
            var date = new Date(y, m, dd), j = worked[date.toDateString()];
            cells.push('<div class="day ' + (j ? 'work' : '') + '" style="' + (j ? 'background:' + color : '') + '" title="' + (j ? '#' + j.id + ' ' + esc(j.cargo) : 'Rest day') + '">' + dd + '</div>');
        }
        openDrawer('<div class="drawer-hero"><div class="eyebrow">Payout · ' + first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) + '</div><h2>' + esc(row.driverName) + '</h2>' +
            '<p><span class="money" style="font-size:20px;color:var(--text)">' + money(row.amount, row.currency) + '</span> for ' + row.workDays + ' work days</p></div>' +
            '<div class="drawer-section"><h4>Work calendar</h4><div class="cal">' + cells.join('') + '</div>' +
            '<p style="color:var(--muted);font-size:12px;margin:12px 0 0">Colored days are covered by billed transports. The payroll engine bills ' + row.workDays + ' work days and ' + row.restDays + ' rest days, and pays 50 EUR per work day.</p></div>' +
            '<div class="drawer-section"><h4>Billed transports · ' + jobs.length + '</h4><div class="history">' + jobs.map(function (j) {
                return '<a href="javascript:void 0" data-job="' + j.id + '">#' + j.id + ' ' + esc(j.from ? j.from.city : '') + ' → ' + esc(j.to ? j.to.city : '') + '<small>' + fmtDate(j.s) + ' – ' + fmtDate(j.f) + '</small></a>';
            }).join('') + '</div></div>');
        bindJobLinks($('#drawer-body'));
    }
    function refresh() {
        state.payCache = {};
        return load().then(function () { if (state.route !== 'command') { ROUTES[state.route].render($('#view')); } else { drawRoutes(); renderTimeline(); updateReplay(); } });
    }

    // ---------- command palette ----------
    var pal = { items: [], sel: 0 };
    function paletteItems() {
        var s = state.snap, items = [
            { kind: 'Page', label: 'Command center', hint: 'map & replay', run: function () { location.hash = '#/command'; } },
            { kind: 'Page', label: 'Jobs', hint: s.transports.length + ' jobs', run: function () { location.hash = '#/jobs'; } },
            { kind: 'Page', label: 'Fleet', hint: 'tractors & trailers', run: function () { location.hash = '#/fleet'; } },
            { kind: 'Page', label: 'Payroll', hint: 'driver payouts', run: function () { location.hash = '#/payroll'; } },
            { kind: 'Action', label: 'Toggle dark / light theme', hint: '', run: toggleTheme },
            { kind: 'Action', label: 'Replay the fleet', hint: 'play from the start', run: function () { state.replay.t = state.replay.min; location.hash = '#/command'; setTimeout(startReplay, 400); } },
            { kind: 'Action', label: 'Open classic UI', hint: 'legacy pages', run: function () { location.href = '/classic'; } }
        ];
        s.drivers.forEach(function (d) { items.push({ kind: 'Driver', label: d.name, hint: d.homeCity || '', run: function () { openDriver(d.id); } }); });
        s.tractors.concat(s.trailers).forEach(function (v) { items.push({ kind: v.kind, label: v.plate + ' ' + v.make + ' ' + v.model, hint: v.inspectionDaysRemaining + ' d to inspection', run: function () { openVehicle(v.kind, v.id); } }); });
        s.transports.forEach(function (j) { items.push({ kind: 'Job', label: '#' + j.id + ' ' + (j.from ? j.from.city : '') + ' → ' + (j.to ? j.to.city : '') + ' · ' + j.cargo, hint: fmtDate(j.s), run: function () { openJob(j.id); } }); });
        return items;
    }
    function openPalette() {
        if (!state.snap) { return; }
        $('#palette').classList.add('open');
        $('#palette-input').value = '';
        filterPalette('');
        $('#palette-input').focus();
    }
    function closePalette() { $('#palette').classList.remove('open'); }
    function filterPalette(q) {
        q = q.toLowerCase().trim();
        var all = paletteItems();
        pal.items = !q ? all.slice(0, 12) : all.map(function (it) {
            var hay = (it.kind + ' ' + it.label + ' ' + it.hint).toLowerCase(), score = 0, pos = 0;
            for (var i = 0; i < q.length; i++) {
                var f = hay.indexOf(q[i], pos);
                if (f < 0) { return null; }
                score += f - pos; pos = f + 1;
            }
            if (hay.indexOf(q) >= 0) { score -= 100; }
            return { it: it, score: score };
        }).filter(Boolean).sort(function (a, b) { return a.score - b.score; }).slice(0, 12).map(function (x) { return x.it; });
        pal.sel = 0;
        drawPalette();
    }
    function drawPalette() {
        $('#palette-list').innerHTML = pal.items.map(function (it, i) {
            return '<li class="' + (i === pal.sel ? 'sel' : '') + '" data-i="' + i + '"><span class="kind">' + esc(it.kind) + '</span>' + esc(it.label) + '<small>' + esc(it.hint) + '</small></li>';
        }).join('') || '<li><span class="kind">-</span>No matches</li>';
        $all('#palette-list li[data-i]').forEach(function (li) {
            li.addEventListener('click', function () { runPalette(Number(li.getAttribute('data-i'))); });
            li.addEventListener('mousemove', function () { if (pal.sel !== Number(li.getAttribute('data-i'))) { pal.sel = Number(li.getAttribute('data-i')); drawPalette(); } });
        });
    }
    function runPalette(i) { var it = pal.items[i]; closePalette(); if (it) { it.run(); } }

    // ---------- theme & global keys ----------
    function applyTheme(t) { document.documentElement.setAttribute('data-theme', t); storage('fleetos-theme', t); }
    function toggleTheme() {
        applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
        if (state.route === 'command') { go(); }
    }
    function tickClock() { $('#clock').textContent = new Date().toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }); }

    document.addEventListener('keydown', function (e) {
        var palOpen = $('#palette').classList.contains('open');
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); palOpen ? closePalette() : openPalette(); return; }
        if (e.key === 'Escape') { if (palOpen) { closePalette(); } else { closeDrawer(); } return; }
        if (palOpen) {
            if (e.key === 'ArrowDown') { e.preventDefault(); pal.sel = Math.min(pal.items.length - 1, pal.sel + 1); drawPalette(); }
            if (e.key === 'ArrowUp') { e.preventDefault(); pal.sel = Math.max(0, pal.sel - 1); drawPalette(); }
            if (e.key === 'Enter') { e.preventDefault(); runPalette(pal.sel); }
            return;
        }
        var typing = /input|textarea|select/i.test((document.activeElement || {}).tagName || '');
        if (!typing && e.key === ' ' && state.route === 'command') { e.preventDefault(); state.replay.playing ? stopReplay() : startReplay(); }
        if (!typing && e.key === '/') { e.preventDefault(); openPalette(); }
    });
    $('#palette-input').addEventListener('input', function (e) { filterPalette(e.target.value); });
    $('#palette').addEventListener('click', function (e) { if (e.target.id === 'palette') { closePalette(); } });
    $('#open-palette').addEventListener('click', openPalette);
    $('#drawer-close').addEventListener('click', closeDrawer);
    $('#drawer-backdrop').addEventListener('click', closeDrawer);
    $('#theme-toggle').addEventListener('click', toggleTheme);
    window.addEventListener('hashchange', function () { closeDrawer(); go(); });
    window.addEventListener('resize', function () { if (state.route === 'command') { renderTimeline(); } });

    applyTheme(storage('fleetos-theme') || 'dark');
    tickClock(); setInterval(tickClock, 1000);
    load().then(go).catch(function (e) {
        $('#view').innerHTML = '<div class="loading">Could not load fleet data: ' + esc(e.message) + '</div>';
    });
})();
