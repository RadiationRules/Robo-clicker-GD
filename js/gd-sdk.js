/**
 * GameDistribution SDK Wrapper
 * Handles all GameDistribution SDK interactions for Robo Clicker
 */

// Global State
window.GD_SDK_READY = false;
window.__gd_reward_callback = null;
window.__lastInterstitialTime = 0;
const INTERSTITIAL_COOLDOWN = 60000; // 60 seconds between interstitials

// Safe storage fallback when tracking prevention blocks access to localStorage/cookies
const SafeStorage = (function() {
    let fallback = {};
    function canUseLocalStorage() {
        try {
            const test = '__gd_test__';
            localStorage.setItem(test, test);
            localStorage.removeItem(test);
            return true;
        } catch (e) {
            return false;
        }
    }
    const hasLS = canUseLocalStorage();

    return {
        getItem(key) {
            if (hasLS) {
                try { return localStorage.getItem(key); } catch (e) { return fallback[key] || null; }
            }
            return fallback[key] || null;
        },
        setItem(key, value) {
            if (hasLS) {
                try { localStorage.setItem(key, value); return true; } catch (e) { fallback[key] = value; return false; }
            }
            fallback[key] = value; return false;
        },
        removeItem(key) {
            if (hasLS) {
                try { localStorage.removeItem(key); } catch (e) { delete fallback[key]; }
            } else {
                delete fallback[key];
            }
        }
    };
})();

const SafeCookies = (function() {
    function readCookie(name) {
        try {
            const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()\[\]\\\/\+^])/g,'\\$1') + '=([^;]*)'));
            return m ? decodeURIComponent(m[1]) : null;
        } catch (e) { return null; }
    }
    function setCookie(name, value, days) {
        try {
            let s = name + '=' + encodeURIComponent(value) + '; path=/; SameSite=Lax';
            if (days) {
                const d = new Date(); d.setTime(d.getTime() + (days*24*60*60*1000));
                s += '; expires=' + d.toUTCString();
            }
            document.cookie = s;
            return true;
        } catch (e) { return false; }
    }
    function erase(name) {
        try { document.cookie = name + '=; Max-Age=0; path=/; SameSite=Lax'; } catch (e) {}
    }
    return { readCookie, setCookie, erase };
})();

// Consent handling (safely persisted via SafeStorage / cookies fallback)
function applyConsentToSDK() {
    try {
        if (typeof gdsdk !== 'undefined' && typeof gdsdk.setConsent === 'function') {
            gdsdk.setConsent(window.GD_USER_CONSENT || {});
        }
    } catch (e) {
        console.warn('[GD SDK] applyConsentToSDK failed:', e);
    }
    if (window.GD_OPTIONS) window.GD_OPTIONS.userConsent = window.GD_USER_CONSENT || {};
}

function gdCheckConsent() {
    const stored = SafeStorage.getItem('gd_consent');
    if (stored) {
        try { window.GD_USER_CONSENT = JSON.parse(stored); } catch (e) { window.GD_USER_CONSENT = {tracking:false,targeting:false}; }
        applyConsentToSDK();
        return window.GD_USER_CONSENT;
    }

    // Create minimal consent banner (non-blocking)
    try {
        const banner = document.createElement('div');
        banner.id = 'gd-consent-banner';
        banner.style.position = 'fixed';
        banner.style.left = '12px';
        banner.style.bottom = '12px';
        banner.style.zIndex = 99999;
        banner.style.background = 'rgba(0,0,0,0.85)';
        banner.style.color = 'white';
        banner.style.padding = '12px 14px';
        banner.style.borderRadius = '8px';
        banner.style.fontSize = '14px';
        banner.style.maxWidth = '420px';
        banner.style.boxShadow = '0 6px 20px rgba(0,0,0,0.4)';
        banner.innerHTML = '<div style="margin-bottom:8px; font-weight:700;">Privacy & Ads</div>' +
            '<div style="margin-bottom:8px; color:#ddd;">We use ads to keep the game free. Allow personalized ads?</div>' +
            '<div style="text-align:right"><button id="gd-consent-decline" style="margin-right:8px;padding:6px 10px;border-radius:6px;border:1px solid #666;background:transparent;color:#fff">Decline</button><button id="gd-consent-accept" style="padding:6px 10px;border-radius:6px;border:0;background:#8e44ad;color:#fff">Accept</button></div>';

        document.body.appendChild(banner);

        document.getElementById('gd-consent-accept').addEventListener('click', function() {
            const consent = { tracking: true, targeting: true };
            SafeStorage.setItem('gd_consent', JSON.stringify(consent));
            SafeCookies.setCookie('gd_consent', JSON.stringify(consent), 365);
            window.GD_USER_CONSENT = consent;
            applyConsentToSDK();
            banner.remove();
        });

        document.getElementById('gd-consent-decline').addEventListener('click', function() {
            const consent = { tracking: false, targeting: false };
            SafeStorage.setItem('gd_consent', JSON.stringify(consent));
            SafeCookies.setCookie('gd_consent', JSON.stringify(consent), 365);
            window.GD_USER_CONSENT = consent;
            applyConsentToSDK();
            banner.remove();
        });
    } catch (e) {
        console.warn('[GD SDK] Could not render consent banner:', e);
        window.GD_USER_CONSENT = { tracking: false, targeting: false };
        SafeStorage.setItem('gd_consent', JSON.stringify(window.GD_USER_CONSENT));
        applyConsentToSDK();
    }

    return window.GD_USER_CONSENT;
}

// Intercept fetch and XHR to surface 403 errors from ad resources (helpful for debugging 403s)
function _install403Handlers() {
    if (window.fetch) {
        const _origFetch = window.fetch.bind(window);
        window.fetch = function(input, init) {
            return _origFetch(input, init).then(function(resp) {
                try {
                    const url = (typeof input === 'string') ? input : (input && input.url) || '';
                    if (resp && resp.status === 403 && /gamedistribution|ads|adservice|doubleclick|google/gi.test(url)) {
                        _showAd403Notice(url);
                    }
                } catch (e) {}
                return resp;
            }).catch(function(err) {
                console.error('[GD SDK] fetch error', err);
                throw err;
            });
        };
    }

    // XHR hook
    try {
        const XOpen = XMLHttpRequest.prototype.open;
        const XSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function() {
            this.__gd_url = arguments[1];
            return XOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function() {
            this.addEventListener('readystatechange', function() {
                try {
                    if (this.readyState === 4 && this.status === 403 && /gamedistribution|ads|adservice|doubleclick|google/gi.test(this.__gd_url || '')) {
                        _showAd403Notice(this.__gd_url);
                    }
                } catch (e) {}
            });
            return XSend.apply(this, arguments);
        };
    } catch (e) { /* ignore */ }

    function _showAd403Notice(url) {
        console.error('[GD SDK] 403 returned for ad/resource:', url);
        if (!document.getElementById('gd-ad-403-warning')) {
            try {
                const n = document.createElement('div');
                n.id = 'gd-ad-403-warning';
                n.style.position = 'fixed';
                n.style.right = '12px';
                n.style.bottom = '12px';
                n.style.background = 'rgba(255,80,80,0.95)';
                n.style.color = 'white';
                n.style.padding = '10px 12px';
                n.style.borderRadius = '8px';
                n.style.zIndex = 99999;
                n.style.maxWidth = '360px';
                n.innerHTML = '<strong>Ad load blocked (403)</strong><div style="font-size:12px;margin-top:6px;">Check your GameDistribution dashboard: ensure your Game ID is correct and your site domain (GitHub Pages domain) is whitelisted for ads. See console for the failing URL.</div>';
                document.body.appendChild(n);
                setTimeout(() => { n.style.opacity = '0'; n.remove(); }, 15000);
            } catch (e) {}
        }
    }
}

// Immediately install handlers and run consent check
_install403Handlers();
// Delay consent check slightly to ensure DOM is ready if this script is loaded in head
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    gdCheckConsent();
} else {
    document.addEventListener('DOMContentLoaded', gdCheckConsent);
}

/**
 * Check if GameDistribution SDK is ready and available
 */
function gdReady() {
    return typeof gdsdk !== "undefined" && window.GD_SDK_READY;
}

/**
 * Show Interstitial Ad (non-rewarded)
 * Pauses game, shows ad, resumes game
 */
function showInterstitialAd() {
    if (!gdReady()) {
        console.log("[GD SDK] Interstitial unavailable - SDK not ready");
        return Promise.resolve(false);
    }

    // Check cooldown to prevent ad spam
    const now = Date.now();
    if (now - window.__lastInterstitialTime < INTERSTITIAL_COOLDOWN) {
        console.log("[GD SDK] Interstitial on cooldown");
        return Promise.resolve(false);
    }

    window.__lastInterstitialTime = now;

    // Pause game
    if (window.pauseGame) window.pauseGame();

    return gdsdk.showAd("interstitial")
        .then(() => {
            console.log("[GD SDK] Interstitial shown successfully");
            if (window.resumeGame) window.resumeGame();
            return true;
        })
        .catch((error) => {
            console.log("[GD SDK] Interstitial error:", error);
            if (window.resumeGame) window.resumeGame();
            return false;
        });
}

/**
 * Show Rewarded Ad
 * Pauses game, shows rewarded ad, calls callback with result
 */
function showRewardedAd(callback) {
    if (!gdReady()) {
        console.log("[GD SDK] Rewarded ad unavailable - SDK not ready");
        if (callback) callback(false);
        return;
    }

    // Pause game
    if (window.pauseGame) window.pauseGame();

    // Store callback for SDK event
    window.__gd_reward_callback = function(success) {
        console.log("[GD SDK] Reward result:", success);
        if (window.resumeGame) window.resumeGame();
        if (callback) callback(success);
        window.__gd_reward_callback = null;
    };

    // Request rewarded ad
    gdsdk.showAd("rewarded")
        .catch((error) => {
            console.log("[GD SDK] Rewarded ad error:", error);
            if (window.__gd_reward_callback) {
                window.__gd_reward_callback(false);
            }
        });
}

/**
 * Initialize pause/resume functions if not already defined
 * These are called by the SDK during ad playback
 * They check for window.game existence dynamically
 */
if (!window.pauseGame) {
    window.pauseGame = function() {
        console.log("[GD SDK] pauseGame called");
        window.__gamePaused = true;
        
        // Try to pause game if it exists
        try {
            if (window.game && typeof window.game.stopGameplay === 'function') {
                window.game.stopGameplay();
            }
        } catch (e) {
            console.error("[GD SDK] Error calling stopGameplay:", e);
        }
    };
}

if (!window.resumeGame) {
    window.resumeGame = function() {
        console.log("[GD SDK] resumeGame called");
        window.__gamePaused = false;
        
        // Try to resume game if it exists
        try {
            if (window.game && typeof window.game.resumeGameplay === 'function') {
                window.game.resumeGameplay();
            }
        } catch (e) {
            console.error("[GD SDK] Error calling resumeGameplay:", e);
        }
    };
}

/**
 * Get SDK status for debugging
 */
function gdGetStatus() {
    return {
        sdkReady: gdReady(),
        gdkType: typeof gdsdk,
        gdOptionsSet: typeof window.GD_OPTIONS !== "undefined"
    };
}

console.log("[GD SDK] Wrapper loaded. Awaiting SDK initialization...");
