/* ========================================================
   AYAKA MOTION - Authentication & API Service (auth.js)
   ======================================================== */
import { CONFIG } from './config.js';

export class AlightMotionAuthBrowser {
    constructor() {
        this.ORDER_ID = CONFIG.ORDER_ID;
        this.API_KEY = CONFIG.API_KEY;
        this.TOKEN = CONFIG.TOKEN;
        this.SKU_TYPE = CONFIG.SKU_TYPE;
        this.FIREBASE_INSTANCE_ID_TOKEN = CONFIG.FIREBASE_INSTANCE_ID_TOKEN;
        this.HEADERS = {
            "Content-Type": "application/json",
            "X-Android-Package": "com.alightcreative.motion",
            "X-Android-Cert": "ECA6BF91B8715A6F810ED0BBFC65B6CD578F52A8",
            "User-Agent": "Mozilla/5.0 (Linux; Android 15; Mobile)"
        };
    }

    extractOobCode(fullUrl) {
        if (!fullUrl) return null;
        try {
            let cleanUrl = fullUrl.replace(/&amp;/g, '&');
            try { cleanUrl = decodeURIComponent(cleanUrl); } catch(e) {}
            const match = cleanUrl.match(/[?&]oobCode=([a-zA-Z0-9_-]+)/i) || cleanUrl.match(/oobCode=([a-zA-Z0-9_-]+)/i);
            if (match && match[1]) return match[1];
            return cleanUrl.trim();
        } catch (e) {
            return fullUrl.trim();
        }
    }

    async sendMagicLink(email) {
        try {
            await fetch(`https://www.googleapis.com/identitytoolkit/v3/relyingparty/createAuthUri?key=${this.API_KEY}`, {
                method: 'POST',
                headers: this.HEADERS,
                body: JSON.stringify({ identifier: email, continueUri: "http://localhost" })
            });
            
            const res = await fetch(`https://www.googleapis.com/identitytoolkit/v3/relyingparty/getOobConfirmationCode?key=${this.API_KEY}`, {
                method: 'POST',
                headers: this.HEADERS,
                body: JSON.stringify({
                    requestType: 6,
                    email: email,
                    androidInstallApp: true,
                    canHandleCodeInApp: true,
                    continueUrl: "https://alightcreative.com",
                    androidPackageName: "com.alightcreative.motion",
                    clientType: "CLIENT_TYPE_ANDROID"
                })
            });
            if (!res.ok) throw new Error(await res.text());
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async verifyAndApply(email, rawLink, productId) {
        try {
            const oobCode = this.extractOobCode(rawLink);
            if (!oobCode) throw new Error("Gagal mengekstrak oobCode.");
            
            const signinRes = await fetch(`https://www.googleapis.com/identitytoolkit/v3/relyingparty/emailLinkSignin?key=${this.API_KEY}`, {
                method: 'POST',
                headers: this.HEADERS,
                body: JSON.stringify({ email: email, oobCode: oobCode, clientType: "CLIENT_TYPE_ANDROID" })
            });
            const signinData = await signinRes.json();
            if (!signinRes.ok || !signinData.idToken) throw new Error("Verifikasi Token Gagal");

            const codeorder = Math.floor(10000 + Math.random() * 90000).toString();
            const purchaseRes = await fetch('https://us-central1-alight-creative.cloudfunctions.net/verifyPurchase', {
                method: 'POST',
                headers: {
                    "authorization": "Bearer " + signinData.idToken,
                    "firebase-instance-id-token": this.FIREBASE_INSTANCE_ID_TOKEN,
                    "content-type": "application/json; charset=utf-8"
                },
                body: JSON.stringify({
                    data: {
                        productId: productId,
                        token: this.TOKEN,
                        skuType: this.SKU_TYPE,
                        orderId: this.ORDER_ID + "-" + codeorder
                    }
                })
            });
            if (!purchaseRes.ok) throw new Error("Gagal menerapkan pembelian premium");
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}
