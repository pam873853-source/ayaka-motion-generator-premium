/* ========================================================
   AYAKA MOTION - Upstash Redis Client (redis.js)
   ======================================================== */

export class UpstashRedisClient {
    constructor(url, token) {
        this.url = url ? url.replace(/\/$/, '') : '';
        this.token = token;
    }

    isConfigured() {
        return this.url.includes("upstash.io") && this.token && !this.token.includes("your-upstash");
    }

    async query(command, ...args) {
        if (!this.isConfigured()) return null;
        try {
            const endpoint = `${this.url}/${command}/${args.map(a => encodeURIComponent(typeof a === 'object' ? JSON.stringify(a) : a)).join('/')}`;
            const res = await fetch(endpoint, {
                headers: { Authorization: `Bearer ${this.token}` }
            });
            if (!res.ok) return null;
            const data = await res.json();
            return data.result;
        } catch (e) {
            console.warn("Upstash Redis error:", e);
            return null;
        }
    }

    async addActivation(logData) {
        if (!this.isConfigured()) return;
        try {
            await this.query('lpush', 'ayaka_activations', JSON.stringify(logData));
        } catch (e) {
            console.error("Upstash add error:", e);
        }
    }

    async getActivations() {
        if (!this.isConfigured()) return null;
        try {
            const rawList = await this.query('lrange', 'ayaka_activations', '0', '99');
            if (Array.isArray(rawList)) {
                return rawList.map(item => {
                    try { return typeof item === 'string' ? JSON.parse(item) : item; } 
                    catch(e) { return null; }
                }).filter(Boolean);
            }
        } catch (e) {
            console.error("Upstash fetch error:", e);
        }
        return null;
    }

    async addReport(reportData) {
        if (!this.isConfigured()) return;
        try {
            await this.query('lpush', 'ayaka_reports', JSON.stringify(reportData));
        } catch (e) {
            console.error("Upstash add report error:", e);
        }
    }

    async getReports() {
        if (!this.isConfigured()) return null;
        try {
            const rawList = await this.query('lrange', 'ayaka_reports', '0', '99');
            if (Array.isArray(rawList)) {
                return rawList.map(item => {
                    try { return typeof item === 'string' ? JSON.parse(item) : item; } 
                    catch(e) { return null; }
                }).filter(Boolean);
            }
        } catch (e) {
            console.error("Upstash fetch reports error:", e);
        }
        return null;
    }
}
