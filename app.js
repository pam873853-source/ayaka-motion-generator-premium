/* ========================================================
   AYAKA MOTION - Main Controller (app.js)
   ======================================================== */
import { CONFIG } from './config.js';
import { AlightMotionAuthBrowser } from './auth.js';
import { UpstashRedisClient } from './redis.js';

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, onSnapshot, doc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

let app, db, auth, userId = null;
let historyLogs = [];
let reportsLogs = [];
let totalVisitors = 1;
let realTimeChart = null;

let UPSTASH_URL = localStorage.getItem('upstash_redis_url') || "https://your-upstash-redis.upstash.io";
let UPSTASH_TOKEN = localStorage.getItem('upstash_redis_token') || "your-upstash-token";
let upstash = new UpstashRedisClient(UPSTASH_URL, UPSTASH_TOKEN);

const ampAuth = new AlightMotionAuthBrowser();
let activeTabName = 'dashboard';
let verifiedEmailTemp = '';

let startTime = localStorage.getItem('ayaka_uptime_start');
if (!startTime) {
    startTime = Date.now();
    localStorage.setItem('ayaka_uptime_start', startTime);
} else {
    startTime = parseInt(startTime, 10);
}

function initActivationChart() {
    const ctx = document.getElementById('activation-chart');
    if (!ctx) return;

    if (realTimeChart) {
        realTimeChart.destroy();
    }

    realTimeChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'],
            datasets: [{
                label: 'Total Aktivasi',
                data: new Array(12).fill(0),
                borderColor: '#000000',
                backgroundColor: 'rgba(250, 204, 21, 0.45)',
                borderWidth: 3,
                fill: true,
                tension: 0.35,
                pointBackgroundColor: '#facc15',
                pointBorderColor: '#000000',
                pointBorderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 7
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#18181b',
                    titleColor: '#facc15',
                    bodyColor: '#ffffff',
                    borderWidth: 2,
                    borderColor: '#000000',
                    cornerRadius: 8,
                    padding: 10,
                    displayColors: false
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { font: { family: 'Inter', size: 10, weight: 'bold' }, color: '#000000' }
                },
                y: {
                    beginAtZero: true,
                    ticks: { precision: 0, font: { family: 'Inter', size: 10, weight: 'bold' }, color: '#000000' },
                    grid: { color: 'rgba(0, 0, 0, 0.08)' }
                }
            }
        }
    });
    updateChartData();
}

function updateChartData() {
    if (!realTimeChart) return;
    const monthlyCounts = new Array(12).fill(0);
    historyLogs.forEach(item => {
        if (item.timestamp) {
            const date = new Date(item.timestamp);
            const monthIdx = date.getMonth();
            if (monthIdx >= 0 && monthIdx < 12) {
                monthlyCounts[monthIdx]++;
            }
        }
    });
    realTimeChart.data.datasets[0].data = monthlyCounts;
    realTimeChart.update();
}

window.saveUpstashConfig = function() {
    const urlInput = document.getElementById('upstash-url').value.trim();
    const tokenInput = document.getElementById('upstash-token').value.trim();
    
    if (!urlInput || !tokenInput) {
        showToast("URL & Token Upstash Redis wajib diisi!");
        return;
    }

    localStorage.setItem('upstash_redis_url', urlInput);
    localStorage.setItem('upstash_redis_token', tokenInput);
    UPSTASH_URL = urlInput;
    UPSTASH_TOKEN = tokenInput;
    upstash = new UpstashRedisClient(UPSTASH_URL, UPSTASH_TOKEN);
    
    checkRedisStatus();
    syncRedisActivations();
    syncRedisReports();
    showToast("Konfigurasi Upstash Redis Disimpan!");
}

function checkRedisStatus() {
    const badge = document.getElementById('redis-status-badge');
    if (!badge) return;
    if (upstash.isConfigured()) {
        badge.textContent = "TERHUBUNG";
        badge.className = "text-[10px] font-black px-2 py-0.5 rounded bg-emerald-300 text-emerald-900 border border-black";
    } else {
        badge.textContent = "STANDBY";
        badge.className = "text-[10px] font-black px-2 py-0.5 rounded bg-gray-200 text-gray-700";
    }
}

setTimeout(() => {
    const uEl = document.getElementById('upstash-url');
    const tEl = document.getElementById('upstash-token');
    if (uEl) uEl.value = localStorage.getItem('upstash_redis_url') || '';
    if (tEl) tEl.value = localStorage.getItem('upstash_redis_token') || '';
    checkRedisStatus();
}, 300);

window.setActiveTab = function(tab) {
    activeTabName = tab;
    ['dashboard', 'aktivasi', 'riwayat', 'laporan'].forEach(t => {
        const view = document.getElementById(`view-${t}`);
        const btn = document.getElementById(`nav-${t}`);
        if (view) view.classList.toggle('hidden', t !== tab);
        if (btn) {
            btn.className = (t === tab) 
                ? "neo-btn-yellow py-2 text-[10px] flex flex-col items-center justify-center gap-0.5" 
                : "neo-btn py-2 text-[10px] flex flex-col items-center justify-center gap-0.5";
        }
    });
    if (tab === 'riwayat') {
        renderHistory();
        setTimeout(() => {
            if (!realTimeChart) initActivationChart();
            else updateChartData();
        }, 100);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

window.switchActivationStep = function(step) {
    const s1 = document.getElementById('neo-step-1');
    const s2 = document.getElementById('neo-step-2');
    const b1 = document.getElementById('tab-btn-kirim');
    const b2 = document.getElementById('tab-btn-verifikasi');
    if (step === 1) {
        s1.classList.remove('hidden');
        s2.classList.add('hidden');
        b1.className = "neo-btn-dark py-2.5 text-xs flex items-center justify-center gap-2";
        b2.className = "neo-btn py-2.5 text-xs flex items-center justify-center gap-2";
    } else {
        s1.classList.add('hidden');
        s2.classList.remove('hidden');
        b1.className = "neo-btn py-2.5 text-xs flex items-center justify-center gap-2";
        b2.className = "neo-btn-dark py-2.5 text-xs flex items-center justify-center gap-2";
    }
}

window.handleSendMagicLink = async function() {
    const email = document.getElementById('amp-email').value.trim();
    if (!email) {
        showToast("Masukkan email terlebih dahulu!");
        return;
    }
    const btn = document.getElementById('btn-send-link');
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> Mengirim...`;

    const res = await ampAuth.sendMagicLink(email);
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Kirim Magic Link ke Email`;

    if (res.success) {
        verifiedEmailTemp = email;
        showToast("Magic Link berhasil dikirim ke email!");
        switchActivationStep(2);
    } else {
        showToast("Gagal: " + res.error);
    }
}

window.handleVerifyAndApply = async function() {
    const email = verifiedEmailTemp || document.getElementById('amp-email').value.trim();
    const link = document.getElementById('amp-magic-link').value.trim();
    const pkg = document.getElementById('amp-package').value;

    if (!email || !link) {
        showToast("Email dan Magic Link wajib diisi!");
        return;
    }

    const btn = document.getElementById('btn-verify-apply');
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> Memproses...`;

    const res = await ampAuth.verifyAndApply(email, link, pkg);
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-bolt"></i> Verifikasi & Aktifkan Sekarang`;

    if (res.success) {
        showToast("Akun Berhasil Diaktifkan ke Premium!");
        const todayStr = new Date().toDateString();
        const logData = {
            user: email,
            type: pkg.includes('annual') ? '1 Tahun Premium' : '1 Bulan Premium',
            timestamp: Date.now(),
            dateString: todayStr,
            senderId: userId
        };

        await upstash.addActivation(logData);

        if (db && userId) {
            try {
                await addDoc(collection(db, 'artifacts', CONFIG.APP_ID, 'public', 'data', 'activations'), logData);
            } catch (e) {
                console.error("Firestore sync error:", e);
            }
        }

        document.getElementById('amp-email').value = '';
        document.getElementById('amp-magic-link').value = '';
        switchActivationStep(1);
        syncRedisActivations();
    } else {
        showToast("Gagal: " + res.error);
    }
}

function renderHistory() {
    const container = document.getElementById('history-feed-container');
    if (!historyLogs || historyLogs.length === 0) {
        container.innerHTML = `
            <div class="neo-card p-8 text-center space-y-2 bg-white">
                <i class="fa-solid fa-box-open text-3xl text-gray-400"></i>
                <p class="text-xs font-black">Belum Ada Riwayat Aktivasi</p>
            </div>
        `;
        return;
    }
    container.innerHTML = historyLogs.map(item => `
        <div class="neo-card p-3.5 flex items-center justify-between bg-white">
            <div>
                <p class="text-xs font-black">${item.user}</p>
                <p class="text-[10px] font-bold text-gray-500">${item.type}</p>
            </div>
            <span class="px-2.5 py-1 bg-emerald-400 border-2 border-black rounded-lg text-[10px] font-black">
                AKTIF
            </span>
        </div>
    `).join('');
}

window.clearHistoryFeed = function() {
    if (confirm("Hapus seluruh riwayat lokal?")) {
        historyLogs = [];
        renderHistory();
        updateCounts();
        updateChartData();
        showToast("Riwayat dibersihkan.");
    }
}

window.submitBugReport = async function() {
    const category = document.getElementById('report-category').value;
    const description = document.getElementById('report-description').value.trim();

    if (!description) {
        showToast("Mohon isi deskripsi kendala/saran terlebih dahulu!");
        return;
    }

    const btn = document.getElementById('btn-submit-report');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> Menyimpan...`;
    }

    const reportData = {
        category: category,
        description: description,
        timestamp: Date.now(),
        dateString: new Date().toLocaleDateString('id-ID') + ' ' + new Date().toLocaleTimeString('id-ID'),
        senderId: userId || 'Anonymous'
    };

    await upstash.addReport(reportData);

    if (db && userId) {
        try {
            await addDoc(collection(db, 'artifacts', CONFIG.APP_ID, 'public', 'data', 'reports'), reportData);
        } catch (e) {
            console.error("Firestore report sync error:", e);
        }
    }

    if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-database"></i> Kirim & Simpan Laporan ke Database`;
    }

    document.getElementById('report-description').value = '';
    showToast("Laporan berhasil disimpan ke Database!");
    syncRedisReports();
}

function renderReports() {
    const container = document.getElementById('reports-list-container');
    const badge = document.getElementById('reports-count-badge');
    if (!container) return;

    if (badge) badge.textContent = (reportsLogs ? reportsLogs.length : 0) + " Laporan";

    if (!reportsLogs || reportsLogs.length === 0) {
        container.innerHTML = `<p class="text-xs text-gray-400 font-bold text-center py-4">Belum ada laporan tersimpan.</p>`;
        return;
    }

    container.innerHTML = reportsLogs.map(item => `
        <div class="neo-card p-3 bg-zinc-50 border-2 border-black space-y-1">
            <div class="flex items-center justify-between">
                <span class="text-[9px] font-black uppercase px-2 py-0.5 rounded bg-yellow-300 border border-black">${item.category}</span>
                <span class="text-[9px] font-mono font-bold text-gray-500">${item.dateString || ''}</span>
            </div>
            <p class="text-xs font-semibold text-black break-words pt-1">${item.description}</p>
        </div>
    `).join('');
}

async function syncRedisReports() {
    if (upstash.isConfigured()) {
        const redisReports = await upstash.getReports();
        if (redisReports) {
            reportsLogs = redisReports;
            renderReports();
        }
    }
}

window.openDirectOwnerChat = function() {
    let cleanNum = localStorage.getItem('ayaka_owner_wa') || CONFIG.DEFAULT_OWNER_WA;
    const waUrl = `https://wa.me/${cleanNum}?text=Halo%20Owner%20AYAKA%20MOTION,%20saya%20ingin%20berkonsultasi.`;
    window.open(waUrl, '_blank');
}

setTimeout(() => {
    let savedNum = localStorage.getItem('ayaka_owner_wa') || CONFIG.DEFAULT_OWNER_WA;
    const displayEl = document.getElementById('owner-wa-number-display');
    if (displayEl) displayEl.textContent = '+' + savedNum;
}, 300);

function showToast(msg) {
    const toast = document.getElementById('toast-notif');
    document.getElementById('toast-message').textContent = msg;
    toast.classList.remove('opacity-0', 'pointer-events-none');
    setTimeout(() => toast.classList.add('opacity-0', 'pointer-events-none'), 3000);
}

function updateCounts() {
    const countActivations = historyLogs.length;
    const actEl = document.getElementById('activations-count');
    const actTotalEl = document.getElementById('act-total-count');
    const actTodayEl = document.getElementById('act-today-count');

    if (actEl) actEl.textContent = countActivations;
    if (actTotalEl) actTotalEl.textContent = countActivations;

    const todayStr = new Date().toDateString();
    const todayCount = historyLogs.filter(h => h.dateString === todayStr).length;
    if (actTodayEl) actTodayEl.textContent = todayCount;

    const visitorsEl = document.getElementById('visitors-count');
    if (visitorsEl) visitorsEl.textContent = Math.max(1, totalVisitors);

    updateChartData();
}

async function syncRedisActivations() {
    if (upstash.isConfigured()) {
        const redisData = await upstash.getActivations();
        if (redisData && redisData.length > 0) {
            historyLogs = redisData;
            historyLogs.sort((a, b) => b.timestamp - a.timestamp);
            updateCounts();
            if (activeTabName === 'riwayat') {
                renderHistory();
                updateChartData();
            }
        }
    }
}

async function initFirebase() {
    try {
        app = initializeApp(CONFIG.FIREBASE_CONFIG);
        db = getFirestore(app);
        auth = getAuth(app);

        if (CONFIG.INITIAL_AUTH_TOKEN) {
            await signInWithCustomToken(auth, CONFIG.INITIAL_AUTH_TOKEN);
        } else {
            await signInAnonymously(auth);
        }
        userId = auth.currentUser?.uid || crypto.randomUUID();

        async function pingRedisVisitor() {
            if (upstash.isConfigured()) {
                await upstash.query('sadd', 'ayaka_active_visitors', userId);
                const rawVisitors = await upstash.query('smembers', 'ayaka_active_visitors');
                if (Array.isArray(rawVisitors)) {
                    totalVisitors = Math.max(1, rawVisitors.length);
                    updateCounts();
                }
            }
        }

        pingRedisVisitor();
        setInterval(pingRedisVisitor, 10000);

        const visitorRef = doc(db, 'artifacts', CONFIG.APP_ID, 'public', 'data', 'visitors', userId);
        await setDoc(visitorRef, {
            lastSeen: Date.now(),
            userAgent: navigator.userAgent
        }, { merge: true });

        const visitorsCol = collection(db, 'artifacts', CONFIG.APP_ID, 'public', 'data', 'visitors');
        onSnapshot(visitorsCol, (snapshot) => {
            if (!upstash.isConfigured()) {
                totalVisitors = snapshot.size;
                updateCounts();
            }
        });

        const activationsCol = collection(db, 'artifacts', CONFIG.APP_ID, 'public', 'data', 'activations');
        onSnapshot(activationsCol, (snapshot) => {
            let firestoreLogs = [];
            snapshot.forEach(docSnap => firestoreLogs.push(docSnap.data()));
            
            if (!upstash.isConfigured() || firestoreLogs.length > historyLogs.length) {
                historyLogs = firestoreLogs;
                historyLogs.sort((a, b) => b.timestamp - a.timestamp);
                updateCounts();
                if (activeTabName === 'riwayat') renderHistory();
            }
        });

        const reportsCol = collection(db, 'artifacts', CONFIG.APP_ID, 'public', 'data', 'reports');
        onSnapshot(reportsCol, (snapshot) => {
            let firestoreReports = [];
            snapshot.forEach(docSnap => firestoreReports.push(docSnap.data()));
            if (!upstash.isConfigured() && firestoreReports.length > 0) {
                reportsLogs = firestoreReports;
                reportsLogs.sort((a, b) => b.timestamp - a.timestamp);
                renderReports();
            }
        });

    } catch (e) {
        console.error("Firebase init error:", e);
    }
}

initFirebase();
syncRedisActivations();
syncRedisReports();
setInterval(() => {
    syncRedisActivations();
    syncRedisReports();
}, 5000);

let batteryInstance = null;
if ('getBattery' in navigator) {
    navigator.getBattery().then(batt => {
        batteryInstance = batt;
        updateBatteryDisplay();
        batt.addEventListener('levelchange', updateBatteryDisplay);
        batt.addEventListener('chargingchange', updateBatteryDisplay);
    });
}

function updateBatteryDisplay() {
    const batTextEl = document.getElementById('battery-text');
    if (batteryInstance && batTextEl) {
        const levelPct = Math.round(batteryInstance.level * 100);
        const isCharging = batteryInstance.charging;
        batTextEl.textContent = levelPct + '%' + (isCharging ? ' ⚡' : '');
    } else {
        batTextEl.textContent = '100% (OK)';
    }
}

function updateLiveWidgets() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const clockEl = document.getElementById('live-clock');
    if (clockEl) clockEl.textContent = timeStr;

    const fullDateStr = now.toLocaleDateString('id-ID') + ' ' + now.toLocaleTimeString('id-ID');
    const dtEl = document.getElementById('current-date-time');
    if (dtEl) dtEl.textContent = fullDateStr;

    const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
    const mins = Math.floor(elapsedSec / 60).toString().padStart(2, '0');
    const secs = (elapsedSec % 60).toString().padStart(2, '0');
    const uptimeEl = document.getElementById('live-uptime');
    if (uptimeEl) uptimeEl.textContent = `${mins}:${secs}`;
}

updateLiveWidgets();
setInterval(updateLiveWidgets, 1000);

async function updateLatency() {
    const latencyEl = document.getElementById('header-latency');
    if (!latencyEl) return;
    const start = performance.now();
    try {
        await fetch('https://www.google.com/favicon.ico', { mode: 'no-cors', cache: 'no-store' });
        const end = performance.now();
        const latency = Math.round(end - start);
        latencyEl.textContent = Math.max(8, Math.min(latency, 120)) + 'ms';
    } catch (e) {
        const randomMs = Math.floor(Math.random() * 15) + 10;
        latencyEl.textContent = randomMs + 'ms';
    }
}
setInterval(updateLatency, 4000);
updateLatency();
