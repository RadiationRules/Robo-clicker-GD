/**
 * GameDistribution SDK Wrapper
 * Handles all GameDistribution SDK interactions for Robo Clicker
 */

// Global State
window.GD_SDK_READY = false;
window.__gd_reward_callback = null;
window.__lastInterstitialTime = 0;
const INTERSTITIAL_COOLDOWN = 60000; // 60 seconds between interstitials

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
