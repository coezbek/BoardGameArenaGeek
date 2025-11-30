// ==UserScript==
// @name         BGA to BGG - BoardGameArenaGeek
// @namespace    https://github.com/coezbek/BoardGameArenaGeek
// @version      18.0
// @description  Adds BoardGameGeek scores, rank, complexity, and best player counts to BoardGameArena. Includes robust caching and language fallback.
// @author       coezbek
// @match        https://boardgamearena.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @connect      boardgamegeek.com
// @connect      duckduckgo.com
// @updateURL    https://raw.githubusercontent.com/coezbek/BoardGameArenaGeek/main/BoardGameArenaGeek.user.js
// @downloadURL  https://raw.githubusercontent.com/coezbek/BoardGameArenaGeek/main/BoardGameArenaGeek.user.js
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // --- CONFIGURATION ---
    const REQUEST_DELAY = 1600; // 1.6s delay
    const DATA_CACHE_DAYS = 3;
    const ID_CACHE_DAYS = 365;

    // --- STATE ---
    let totalDetected = 0;
    let totalProcessed = 0;
    let queue = [];
    let isBusy = false;

    // --- UI CONSTRUCTION ---
    const ui = document.createElement('div');
    Object.assign(ui.style, {
        position: 'fixed', bottom: '10px', right: '10px', width: '350px', height: '400px',
        display: 'flex', flexDirection: 'column', gap: '5px', zIndex: '100000',
        fontFamily: 'monospace', fontSize: '12px', pointerEvents: 'none'
    });

    // Status Bar
    const statusBar = document.createElement('div');
    Object.assign(statusBar.style, {
        background: 'rgba(0,0,0,0.95)', color: '#fff', padding: '8px',
        borderRadius: '4px', border: '1px solid #444', pointerEvents: 'auto', fontWeight: 'bold'
    });
    statusBar.innerText = "BGG: Waiting for games...";

    // Controls
    const controls = document.createElement('div');
    Object.assign(controls.style, { display: 'flex', gap: '5px', pointerEvents: 'auto' });
    
    const btnMap = createBtn("Reset IDs", "#c0392b");
    const btnData = createBtn("Reset Scores", "#2980b9");
    const btnForce = createBtn("Force Rescan", "#d35400");
    
    controls.appendChild(btnMap);
    controls.appendChild(btnData);
    controls.appendChild(btnForce);

    // Log Panel
    const logPanel = document.createElement('div');
    Object.assign(logPanel.style, {
        flex: '1', background: 'rgba(0,0,0,0.9)', color: '#eee', overflowY: 'auto',
        padding: '8px', borderRadius: '4px', border: '1px solid #444', 
        pointerEvents: 'auto', display: 'flex', flexDirection: 'column-reverse'
    });

    ui.appendChild(statusBar);
    ui.appendChild(controls);
    ui.appendChild(logPanel);
    document.body.appendChild(ui);

    // --- HELPERS ---
    function createBtn(text, color) {
        const b = document.createElement('button');
        b.innerText = text;
        Object.assign(b.style, {
            background: color, color: 'white', border: '1px solid #fff', padding: '5px',
            cursor: 'pointer', borderRadius: '3px', fontSize: '11px', flex: '1'
        });
        return b;
    }

    function updateStatus() {
        const active = isBusy ? "⚡ Working..." : "✅ Ready";
        statusBar.innerText = `Games: ${totalProcessed} / ${totalDetected} | Queue: ${queue.length} | ${active}`;
        statusBar.style.borderColor = isBusy ? "#f1c40f" : "#2ecc71";
    }

    function log(msg, type = 'info') {
        const time = new Date().toLocaleTimeString().split(' ')[0];
        const colorMap = {
            info: '#bdc3c7',
            success: '#2ecc71',
            cache: '#27ae60', // Darker green for cache
            warn: '#f39c12',
            error: '#e74c3c',
            network: '#3498db'
        };
        
        // Console log
        console.log(`%c[BGG] ${msg}`, `color:${colorMap[type]}`);
        
        // On-screen log
        const line = document.createElement('div');
        line.style.borderBottom = "1px solid #333";
        line.style.padding = "2px 0";
        line.style.color = colorMap[type];
        line.innerText = `[${time}] ${msg}`;
        logPanel.insertBefore(line, logPanel.firstChild);
    }

    // --- BUTTON ACTIONS ---
    btnMap.onclick = () => {
        const keys = GM_listValues().filter(k => k.startsWith('bgg_map_'));
        keys.forEach(k => GM_deleteValue(k));
        log(`Reset ${keys.length} ID mappings. Refresh page.`, 'warn');
    };
    btnData.onclick = () => {
        const keys = GM_listValues().filter(k => k.startsWith('bgg_data_'));
        keys.forEach(k => GM_deleteValue(k));
        log(`Reset ${keys.length} cached scores. Refresh page.`, 'warn');
    };
    btnForce.onclick = () => {
        log("Forcing full rescan...", 'warn');
        document.querySelectorAll('.bga-game-item, .panel-header').forEach(el => delete el.dataset.bggScan);
        scan();
    };

    // --- CACHE ---
    function getCache(key, daysValid) {
        const entry = GM_getValue(key);
        if (!entry) return null;
        if (Date.now() - entry.time > (daysValid * 24 * 60 * 60 * 1000)) return null;
        return entry.val;
    }
    function setCache(key, val) {
        GM_setValue(key, { time: Date.now(), val: val });
    }

    // --- QUEUE ---
    function addToQueue(task) {
        // Check cache immediately
        const cachedData = getCache(`bgg_data_${task.bgaId}`, DATA_CACHE_DAYS);
        const cachedUrl = getCache(`bgg_map_${task.bgaId}`, ID_CACHE_DAYS);

        if (cachedData && cachedUrl) {
            log(`Cache Hit: ${task.cleanName}`, 'cache');
            render(task.el, cachedData, cachedUrl, task.mode);
            totalProcessed++;
            updateStatus();
            return;
        }

        // Avoid duplicates in queue
        if (queue.some(q => q.bgaId === task.bgaId)) return;

        totalDetected++;
        queue.push(task);
        updateStatus();
        processQueue();
    }

    function processQueue() {
        if (isBusy || queue.length === 0) return;
        isBusy = true;
        updateStatus();
        
        const task = queue.shift();
        
        processTask(task)
            .catch(err => log(`Fatal Error on ${task.cleanName}: ${err}`, 'error'))
            .finally(() => {
                totalProcessed++;
                setTimeout(() => {
                    isBusy = false;
                    updateStatus();
                    processQueue();
                }, REQUEST_DELAY);
            });
    }

    // --- PROCESSING ---
    async function processTask(task) {
        const mapKey = `bgg_map_${task.bgaId}`;
        const dataKey = `bgg_data_${task.bgaId}`;

        log(`Processing: ${task.cleanName}`, 'info');

        // 1. Resolve ID
        let bggUrl = getCache(mapKey, ID_CACHE_DAYS);
        if (!bggUrl) {
            log(`Searching DDG for "${task.cleanName}"`, 'network');
            const bggId = await searchDuckDuckGo(task.cleanName);
            
            if (bggId) {
                bggUrl = `https://boardgamegeek.com/boardgame/${bggId}`;
                setCache(mapKey, bggUrl);
                log(`Found ID: ${bggId}`, 'success');
            } else {
                log(`No results for "${task.cleanName}"`, 'error');
                return;
            }
        }

        // 2. Fetch Data
        try {
            const html = await fetchPage(bggUrl);
            const stats = parseBGGHtml(html);

            if (stats) {
                log(`Parsed: ${stats.score} (Rank ${stats.rank})`, 'success');
                setCache(dataKey, stats);
                render(task.el, stats, bggUrl, task.mode);
            } else {
                log(`Parse Failed for ${task.cleanName}`, 'error');
            }
        } catch (e) {
            log(`Fetch Error: ${e.message}`, 'error');
        }
    }

    // --- NETWORKING ---
    function searchDuckDuckGo(query) {
        return new Promise(resolve => {
            const q = encodeURIComponent(`site:boardgamegeek.com/boardgame ${query}`);
            GM_xmlhttpRequest({
                method: "GET",
                url: `https://html.duckduckgo.com/html/?q=${q}`,
                onload: (res) => {
                    const match = res.responseText.match(/boardgamegeek\.com\/boardgame\/(\d+)/);
                    resolve(match ? match[1] : null);
                },
                onerror: () => resolve(null)
            });
        });
    }

    function fetchPage(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET", url,
                onload: (res) => {
                    if (res.status === 200) resolve(res.responseText);
                    else reject(new Error(`HTTP ${res.status}`));
                },
                onerror: (err) => reject(err)
            });
        });
    }

    // --- PARSING ---
    function parseBGGHtml(html) {
        try {
            const regex = /GEEK\.geekitemPreload\s*=\s*(\{.*?\})\s*;\s*GEEK/s;
            const match = html.match(regex);
            if (match && match[1]) {
                const data = JSON.parse(match[1]);
                const item = data.item;
                
                const score = item.stats?.average ? parseFloat(item.stats.average).toFixed(1) : "?";
                const weight = item.stats?.avgweight ? parseFloat(item.stats.avgweight).toFixed(2) : "?";
                
                let rank = "-";
                if (Array.isArray(item.rankinfo)) {
                    const rObj = item.rankinfo.find(r => r.name === "boardgame") || item.rankinfo.find(r => r.id === "1");
                    if (rObj && rObj.rank !== "Not Ranked") rank = rObj.rank;
                }

                let best = "?";
                let min = item.minplayers;
                let max = item.maxplayers;
                
                try {
                    if (item.polls && item.polls.userplayers) {
                        let maxVotes = -1;
                        Object.keys(item.polls.userplayers).forEach(k => {
                            const arr = item.polls.userplayers[k];
                            if (Array.isArray(arr)) {
                                const bestOpt = arr.find(o => o.value === "Best");
                                if (bestOpt) {
                                    const v = parseInt(bestOpt.numvotes);
                                    if (v > maxVotes && v > 0) {
                                        maxVotes = v;
                                        best = k;
                                    }
                                }
                            }
                        });
                    }
                } catch(e) {}

                if (best === "?" || best === "-") {
                    if(min && max) best = (min == max) ? min : `${min}-${max}`;
                }

                return { score, rank, weight, best };
            }
        } catch(e) { console.error(e); }
        return null;
    }

    // --- RENDER ---
    function render(el, data, url, mode) {
        if (el.querySelector('.bgg-badge')) return;

        // CSS: High z-index, absolute positioning for list
        const isList = mode === 'list';
        const styleStr = isList 
            ? "position:absolute; bottom:5px; left:5px; z-index:10000; background:rgba(20,30,40,0.95); font-size:10px; padding:3px 6px;"
            : "display:inline-flex; margin-top:8px; background:#2d3748; font-size:13px; padding:5px 10px;";

        const html = `
            <a href="${url}" target="_blank" class="bgg-badge" style="
                ${styleStr}
                border-left: 4px solid #22c55e; color: white; 
                font-family: 'Roboto', sans-serif; text-decoration: none;
                display: inline-flex; gap: 10px; align-items: center; line-height: 1.2;
                box-shadow: 0 4px 8px rgba(0,0,0,0.6); border-radius: 4px; cursor: pointer;
                transition: transform 0.1s; pointer-events: auto;
            " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                
                <div style="text-align:center">
                    <div style="color:#22c55e;font-weight:bold;font-size:1.2em">${data.score}</div>
                    <div style="color:#a0aec0;font-size:0.8em;text-transform:uppercase">Score</div>
                </div>
                <div style="width:1px; height:20px; background:#4a5568"></div>
                <div style="text-align:center">
                    <div style="font-weight:bold">#${data.rank}</div>
                    <div style="color:#a0aec0;font-size:0.8em;text-transform:uppercase">Rank</div>
                </div>
                <div style="width:1px; height:20px; background:#4a5568"></div>
                <div style="text-align:center">
                    <div style="font-weight:bold">${data.best}</div>
                    <div style="color:#a0aec0;font-size:0.8em;text-transform:uppercase"><i class="fa fa-user"></i></div>
                </div>
                <div style="width:1px; height:20px; background:#4a5568"></div>
                <div style="text-align:center">
                    <div style="font-weight:bold">${data.weight}</div>
                    <div style="color:#a0aec0;font-size:0.8em;text-transform:uppercase">Wght</div>
                </div>
            </a>
        `;
        
        if (isList) {
            // Ensure parent card is relative so absolute positioning works
            el.style.position = 'relative'; 
            el.insertAdjacentHTML('beforeend', html);
        } else {
            el.insertAdjacentHTML('afterend', html);
        }
    }

    // --- SCANNERS ---
    function scan() {
        if(!isBusy && queue.length === 0) updateStatus();

        // 1. LIST VIEW
        if (location.href.includes('gamelist')) {
            document.querySelectorAll('.bga-game-item').forEach(card => {
                if (card.dataset.bggScan) return;
                card.dataset.bggScan = "1";
                
                const nameEl = card.querySelector('.gamename, .text-center');
                const link = card.getAttribute('href');
                
                if (nameEl && link) {
                    const id = link.split('game=')[1];
                    // Fallback: if name is empty, use ID
                    let name = nameEl.innerText.trim();
                    if (!name) name = id.replace(/([A-Z])/g, ' $1').replace(/[0-9]/g, ' ');

                    // Cleanup German/English "Play ... online"
                    name = name.replace(/^(Spiele|Play|Jugar|Jouer)\s+/i, '').replace(/\s+(online|en ligne|im Browser).*$/i, '');

                    addToQueue({ 
                        name: name, 
                        cleanName: name,
                        bgaId: id, 
                        el: card, 
                        mode: 'list' 
                    });
                }
            });
        }

        // 2. PANEL VIEW
        if (location.href.includes('gamepanel')) {
            const params = new URLSearchParams(window.location.search);
            const id = params.get('game');
            const target = document.querySelector('.panel-header .flex.justify-start.items-center');
            const header = document.querySelector('.panel-header');

            if (id && target && header && !header.dataset.bggScan) {
                header.dataset.bggScan = "1";
                let name = document.title.split(' • ')[0].trim();
                name = name.replace(/^(Spiele|Play)\s+/i, '').replace(/\s+(online|en ligne|im Browser).*$/i, '');
                
                addToQueue({ name, cleanName: name, bgaId: id, el: target, mode: 'panel' });
            }
        }
    }

    setInterval(scan, 2000);

})();
