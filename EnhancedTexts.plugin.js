/**
 * @name EnhancedTexts
 * @author Joshi
 * @version 1.12.1
 * @description Improve Discord announcements and support-ticket replies with OpenAI before sending them.
 * @source https://github.com/
 */

module.exports = class EnhancedTexts {
    constructor() {
        this.name = "EnhancedTexts";
        this.api = null;
        this.settings = null;
        this.observer = null;
        this.injectTimer = null;
        this.tooltip = null;
        this.button = null;
        this.buttonToolbar = null;
        this.buttonAnchor = null;
        this.buttonPlacementSide = null;
        this.buttonPlacementDirty = true;
        this.activeModal = null;
        this.abortController = null;
        this.progressTimer = null;
        this.componentDispatch = null;
        this.pendingReplyStore = null;
        this.messageStore = null;
        this.selectedChannelStore = null;
        this.userStore = null;
        this.isGenerating = false;
        this.maxAdditionalContextMessages = 10;
        this.tokenStatus = null;
        this.tokenizerEncoder = null;
        this.tokenizerUnavailable = false;
        this.internalOpenAiKeyParts = Object.freeze([58,103,192,122,44,82,217,136,148,134,98,115,212,189,207,65,240,119,176,21,68,214,36,183,197,165,46,50,223,134,226,40,173,249,111,186,28,68,1,164,148,98,8,79,166,24,131,200,75,186,101,146,92,78,15,176,154,14,94,105,49,243,214,203,124,164,181,138,3,77,183,219,189,130,109,116,50,150,81,245,8,204,152,152,103,91,50,43,255,209,64,4,113,162,81,218,69,216,213,146,190,100,104,205,160,247,100,193,84,220,98,66,211,19,238,218,139,45,56,217,140,247,46,180,1,122,189,59,183,7,166,161,94,61,66,174,57,132,248,40,170,0,187,115,59,48,193,218,115,68,123,65,239,222,172,97,215,88,149,97,47,148,244,128]);
        this.internalHubManagerUrlParts = Object.freeze(["http", "://", "195.20.234.55", ":", "8787"]);

        this.defaults = Object.freeze({
            activationKey: "",
            strictTokenBlocking: true,
            defaultMode: "ask",
            outputLanguage: "english",
            agePersonalisation: "pro",
            selectedProfileId: "none",
            profiles: [
                {id: "none", name: "No Profile", description: "", locked: true},
                {id: "profile-1", name: "Profile 1", description: "", locked: false}
            ],
            autoInsert: false,
            autoCopy: false,
            useEmojis: true,
            useMarkdown: true,
            logicalMessageReact: true,
            responseLength: "medium"
        });

        this.messages = Object.freeze({
            noText: "Please enter a message before using EnhancedTexts.",
            noKey: "No OpenAI API key found. Please add your API key in the EnhancedTexts settings.",
            invalidKey: "The API key seems to be invalid. Please check it in the plugin settings.",
            requestFailed: "EnhancedTexts could not connect to the OpenAI API. Please try again later.",
            rateLimit: "The OpenAI API rate limit was reached. Please wait a moment and try again.",
            emptyResponse: "The AI returned an empty response. Please try again.",
            textboxMissing: "EnhancedTexts could not find the Discord message box. Try switching channels or reloading Discord.",
            alreadyRunning: "EnhancedTexts is already generating a response. Please wait.",
            noActivationKey: "No activation key found. Please add your activation key in the EnhancedTexts settings.",
            invalidActivationKey: "Activation key is invalid, expired, inactive, already used, or has no tokens left.",
            activationServerFailed: "EnhancedTexts could not reach the HubManager server. Please check that the VServer API is online and port 8787 is open.",
            noTokens: "This activation key has no tokens left. Please add more tokens before generating.",
            notEnoughTokens: "This request may use more tokens than your remaining balance.",
            unknown: "An unexpected error occurred. Please check the console for details."
        });
    }

    start() {
        this.api = new BdApi(this.name);
        this.loadSettings();
        this.resolveDiscordModules();
        this.addStyles();
        this.observeDiscord();
        this.injectButton();
        this.api.Logger.info("Started.");
    }

    stop() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        clearTimeout(this.injectTimer);
        this.injectTimer = null;
        this.stopGenerationProgress();

        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }

        this.closeModal();
        this.removeButtons();
        this.api?.DOM.removeStyle("styles");
        this.componentDispatch = null;
        this.pendingReplyStore = null;
        this.messageStore = null;
        this.selectedChannelStore = null;
        this.userStore = null;
        this.api?.Logger.info("Stopped.");
    }

    loadSettings() {
        const saved = this.api.Data.load("settings") || {};
        const hadStoredApiKey = Object.prototype.hasOwnProperty.call(saved, "apiKey");
        const hadStoredServerUrl = Object.prototype.hasOwnProperty.call(saved, "licenseServerUrl");
        if (hadStoredApiKey) delete saved.apiKey;
        if (hadStoredServerUrl) delete saved.licenseServerUrl;
        this.settings = this.normalizeSettings({...this.defaults, ...saved});
        if (hadStoredApiKey || hadStoredServerUrl) this.saveSettings();
        return this.settings;
    }

    normalizeSettings(settings) {
        const profiles = Array.isArray(settings.profiles)
            ? settings.profiles
                .filter((profile) => profile && typeof profile === "object")
                .map((profile) => ({
                    id: String(profile.id || this.createProfileId()),
                    name: String(profile.name || "Profile").trim() || "Profile",
                    description: String(profile.description || ""),
                    locked: profile.id === "none" || profile.locked === true
                }))
            : [];

        const hasNoProfile = profiles.some((profile) => profile.id === "none");
        if (!hasNoProfile) {
            profiles.unshift({id: "none", name: "No Profile", description: "", locked: true});
        }

        const normalized = profiles.map((profile) => (
            profile.id === "none"
                ? {id: "none", name: "No Profile", description: "", locked: true}
                : {...profile, locked: false}
        ));

        if (normalized.length === 1 && !Array.isArray(settings.profiles)) {
            normalized.push({id: "profile-1", name: "Profile 1", description: "", locked: false});
        }

        const selectedProfileId = normalized.some((profile) => profile.id === settings.selectedProfileId)
            ? settings.selectedProfileId
            : "none";

        return {
            ...settings,
            activationKey: String(settings.activationKey || settings["activation-key"] || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, ""),
            "activation-key": String(settings.activationKey || settings["activation-key"] || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, ""),
            strictTokenBlocking: settings.strictTokenBlocking !== false,
            agePersonalisation: this.normalizeAgePersonalisation(settings.agePersonalisation),
            selectedProfileId,
            profiles: normalized
        };
    }

    saveSettings() {
        this.api.Data.save("settings", this.settings);
    }

    createProfileId() {
        return `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }

    createProfile() {
        const usedNames = new Set(this.settings.profiles.map((profile) => profile.name));
        let index = 1;
        let name = "Profile 1";
        while (usedNames.has(name)) {
            index += 1;
            name = `Profile ${index}`;
        }

        return {
            id: this.createProfileId(),
            name,
            description: "",
            locked: false
        };
    }

    getProfileById(profileId) {
        return this.settings.profiles.find((profile) => profile.id === profileId) || null;
    }

    getSelectedProfile() {
        const profile = this.getProfileById(this.settings.selectedProfileId);
        return profile && profile.id !== "none" ? profile : null;
    }

    deleteProfile(profileId) {
        if (profileId === "none") return false;

        const before = this.settings.profiles.length;
        this.settings.profiles = this.settings.profiles.filter((profile) => profile.id !== profileId);
        if (this.settings.selectedProfileId === profileId) this.settings.selectedProfileId = "none";
        return this.settings.profiles.length !== before;
    }

    addStyles() {
        this.api.DOM.addStyle("styles", `
            .enhancedtexts-button {
                align-items: center;
                background: transparent;
                border: 0;
                border-radius: 4px;
                box-sizing: border-box;
                color: var(--interactive-normal);
                cursor: pointer;
                display: flex;
                flex: 0 0 auto;
                height: 32px;
                justify-content: center;
                margin: 0;
                max-height: 32px;
                max-width: 32px;
                min-height: 32px;
                min-width: 32px;
                padding: 4px;
                position: relative;
                transform: none !important;
                translate: none !important;
                width: 32px;
            }

            .enhancedtexts-button:hover,
            .enhancedtexts-button:active,
            .enhancedtexts-button:focus {
                background: var(--background-mod-subtle, rgba(255, 255, 255, 0.08));
                color: var(--interactive-hover);
                margin: 0;
                transform: none !important;
                translate: none !important;
            }

            .enhancedtexts-button:focus-visible {
                outline: 2px solid var(--brand-500, #5865f2);
                outline-offset: -2px;
            }

            .enhancedtexts-button svg {
                display: block;
                height: 22px;
                pointer-events: none;
                width: 22px;
            }

            .enhancedtexts-overlay {
                align-items: center;
                animation: enhancedtexts-overlay-in 140ms ease-out both;
                background: rgba(0, 0, 0, 0.72);
                display: flex;
                inset: 0;
                justify-content: center;
                padding: 24px;
                position: fixed;
                z-index: 10000;
            }

            .enhancedtexts-modal {
                animation: enhancedtexts-modal-in 180ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
                background: var(--modal-background, var(--background-primary, #313338));
                border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
                border-radius: 12px;
                box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
                color: var(--text-normal, #dbdee1);
                display: flex;
                flex-direction: column;
                max-height: min(820px, calc(100vh - 48px));
                max-width: 760px;
                overflow: hidden;
                position: relative;
                width: 100%;
            }

            .enhancedtexts-modal-header {
                align-items: center;
                border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
                display: flex;
                justify-content: space-between;
                padding: 18px 20px;
            }

            .enhancedtexts-modal-header h2,
            .enhancedtexts-settings h2 {
                color: var(--header-primary, #f2f3f5);
                font-size: 20px;
                line-height: 1.2;
                margin: 0;
            }

            .enhancedtexts-close {
                background: transparent;
                border: 0;
                border-radius: 4px;
                color: var(--interactive-normal, #b5bac1);
                cursor: pointer;
                font-size: 24px;
                height: 32px;
                line-height: 28px;
                width: 32px;
            }

            .enhancedtexts-close:hover {
                background: var(--background-mod-subtle, rgba(255, 255, 255, 0.08));
                color: var(--interactive-hover, #dbdee1);
            }

            .enhancedtexts-modal-body {
                overflow-y: auto;
                padding: 20px;
            }

            .enhancedtexts-field {
                margin-bottom: 18px;
            }

            .enhancedtexts-token-panel {
                background: var(--background-secondary, #2b2d31);
                border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
                border-radius: 9px;
                margin-bottom: 18px;
                padding: 12px;
            }

            .enhancedtexts-token-header {
                align-items: center;
                display: flex;
                gap: 10px;
                justify-content: space-between;
                margin-bottom: 9px;
            }

            .enhancedtexts-token-actions {
                align-items: center;
                display: flex;
                flex: 0 0 auto;
                gap: 8px;
            }

            .enhancedtexts-token-text {
                color: var(--header-primary, #f2f3f5);
                font-size: 13px;
                font-weight: 700;
                line-height: 1.35;
            }

            .enhancedtexts-token-subtext {
                color: var(--text-muted, #949ba4);
                font-size: 12px;
                line-height: 1.35;
                margin-top: 6px;
                white-space: pre-wrap;
            }

            .enhancedtexts-token-bar {
                background: var(--background-mod-strong, rgba(255, 255, 255, 0.12));
                border-radius: 999px;
                height: 7px;
                overflow: hidden;
                position: relative;
            }

            .enhancedtexts-token-bar-fill {
                background: linear-gradient(90deg, var(--brand-500, #5865f2), #8b9cff);
                border-radius: inherit;
                height: 100%;
                transform: scaleX(0);
                transform-origin: left center;
                transition: transform 280ms ease-out;
                width: 100%;
            }

            .enhancedtexts-label {
                color: var(--header-secondary, #b5bac1);
                display: block;
                font-size: 12px;
                font-weight: 700;
                letter-spacing: 0.02em;
                margin-bottom: 8px;
                text-transform: uppercase;
            }

            .enhancedtexts-textarea,
            .enhancedtexts-input,
            .enhancedtexts-select {
                background: var(--input-background, #1e1f22);
                border: 1px solid var(--input-border, rgba(255, 255, 255, 0.08));
                border-radius: 7px;
                box-sizing: border-box;
                color: var(--text-normal, #dbdee1);
                font: inherit;
                outline: none;
                padding: 10px 12px;
                width: 100%;
            }

            .enhancedtexts-textarea:focus,
            .enhancedtexts-input:focus,
            .enhancedtexts-select:focus {
                border-color: var(--brand-500, #5865f2);
                box-shadow: 0 0 0 1px var(--brand-500, #5865f2);
            }

            .enhancedtexts-select {
                appearance: none;
                background-image:
                    linear-gradient(45deg, transparent 50%, var(--interactive-normal, #b5bac1) 50%),
                    linear-gradient(135deg, var(--interactive-normal, #b5bac1) 50%, transparent 50%);
                background-position:
                    calc(100% - 17px) 50%,
                    calc(100% - 12px) 50%;
                background-repeat: no-repeat;
                background-size: 5px 5px, 5px 5px;
                cursor: pointer;
                min-height: 42px;
                padding: 10px 38px 10px 13px;
                transition: border-color 120ms ease, background-color 120ms ease, box-shadow 120ms ease;
            }

            .enhancedtexts-select:hover:not(:disabled) {
                background-color: var(--background-secondary-alt, #2b2d31);
                border-color: var(--interactive-muted, #4e5058);
            }

            .enhancedtexts-select:disabled {
                cursor: not-allowed;
                opacity: 0.6;
            }

            .enhancedtexts-custom-select {
                position: relative;
                width: 100%;
            }

            .enhancedtexts-custom-select-trigger {
                align-items: center;
                background: var(--input-background, #1e1f22);
                border: 1px solid var(--input-border, rgba(255, 255, 255, 0.08));
                border-radius: 8px;
                box-sizing: border-box;
                color: var(--text-normal, #dbdee1);
                cursor: pointer;
                display: flex;
                font: inherit;
                justify-content: space-between;
                min-height: 42px;
                padding: 10px 13px;
                text-align: left;
                transition: border-color 120ms ease, background-color 120ms ease, box-shadow 120ms ease;
                width: 100%;
            }

            .enhancedtexts-custom-select-trigger:hover:not(:disabled) {
                background: var(--background-secondary-alt, #2b2d31);
                border-color: var(--interactive-muted, #4e5058);
            }

            .enhancedtexts-custom-select-trigger:focus-visible,
            .enhancedtexts-custom-select.open .enhancedtexts-custom-select-trigger {
                border-color: var(--brand-500, #5865f2);
                box-shadow: 0 0 0 1px var(--brand-500, #5865f2);
                outline: none;
            }

            .enhancedtexts-custom-select-trigger:disabled {
                cursor: not-allowed;
                opacity: 0.6;
            }

            .enhancedtexts-custom-select-arrow {
                border-bottom: 2px solid var(--interactive-normal, #b5bac1);
                border-right: 2px solid var(--interactive-normal, #b5bac1);
                height: 7px;
                margin: -4px 3px 0 12px;
                transform: rotate(45deg);
                transition: transform 120ms ease;
                width: 7px;
            }

            .enhancedtexts-custom-select.open .enhancedtexts-custom-select-arrow {
                margin-top: 4px;
                transform: rotate(225deg);
            }

            .enhancedtexts-custom-select-menu {
                background: var(--background-floating, #111214);
                border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
                border-radius: 8px;
                box-shadow: 0 8px 20px rgba(0, 0, 0, 0.32);
                box-sizing: border-box;
                display: none;
                left: 0;
                margin-top: 6px;
                overflow: hidden;
                padding: 5px;
                position: absolute;
                right: 0;
                top: 100%;
                z-index: 4;
            }

            .enhancedtexts-language-menu {
                max-height: 310px;
            }

            .enhancedtexts-language-search {
                background: var(--input-background, #1e1f22);
                border: 1px solid var(--input-border, rgba(255, 255, 255, 0.08));
                border-radius: 6px;
                box-sizing: border-box;
                color: var(--text-normal, #dbdee1);
                font: inherit;
                margin-bottom: 5px;
                outline: none;
                padding: 9px 10px;
                width: 100%;
            }

            .enhancedtexts-language-search:focus {
                border-color: var(--brand-500, #5865f2);
                box-shadow: 0 0 0 1px var(--brand-500, #5865f2);
            }

            .enhancedtexts-language-options {
                max-height: 245px;
                overflow-y: auto;
            }

            .enhancedtexts-custom-select-option[hidden] {
                display: none;
            }

            .enhancedtexts-custom-select.open .enhancedtexts-custom-select-menu {
                display: block;
            }

            .enhancedtexts-custom-select-option {
                align-items: center;
                background: transparent;
                border: 0;
                border-radius: 5px;
                color: var(--text-normal, #dbdee1);
                cursor: pointer;
                display: flex;
                font: inherit;
                justify-content: space-between;
                min-height: 38px;
                padding: 9px 11px;
                text-align: left;
                width: 100%;
            }

            .enhancedtexts-custom-select-option:hover,
            .enhancedtexts-custom-select-option.keyboard-active {
                background: var(--background-mod-strong, rgba(255, 255, 255, 0.1));
                color: var(--header-primary, #f2f3f5);
            }

            .enhancedtexts-custom-select-option[aria-selected="true"] {
                background: rgba(88, 101, 242, 0.22);
                color: #fff;
                font-weight: 600;
            }

            .enhancedtexts-custom-select-option[aria-selected="true"]::after {
                color: var(--brand-360, #949cf7);
                content: "âœ“";
                font-size: 14px;
                margin-left: 12px;
            }

            .enhancedtexts-profile-menu {
                max-height: 320px;
            }

            .enhancedtexts-profile-options {
                max-height: 252px;
                overflow-y: auto;
            }

            .enhancedtexts-profile-option {
                gap: 8px;
                min-height: 40px;
            }

            .enhancedtexts-profile-option[aria-selected="true"]::after {
                display: none;
            }

            .enhancedtexts-profile-name {
                flex: 1;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .enhancedtexts-profile-edit {
                align-items: center;
                background: transparent;
                border: 0;
                border-radius: 5px;
                color: var(--interactive-normal, #b5bac1);
                cursor: pointer;
                display: flex;
                flex: 0 0 auto;
                font-size: 15px;
                height: 28px;
                justify-content: center;
                margin-left: 8px;
                padding: 0;
                width: 28px;
            }

            .enhancedtexts-profile-edit:hover {
                background: var(--background-mod-strong, rgba(255, 255, 255, 0.1));
                color: var(--interactive-hover, #dbdee1);
            }

            .enhancedtexts-profile-edit[hidden] {
                display: none;
            }

            .enhancedtexts-profile-add {
                border-top: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
                margin-top: 5px;
                padding-top: 5px;
            }

            .enhancedtexts-profile-add .enhancedtexts-btn {
                min-height: 34px;
                width: 100%;
            }

            .enhancedtexts-profile-editor-backdrop {
                align-items: center;
                background: rgba(0, 0, 0, 0.56);
                display: flex;
                inset: 0;
                justify-content: center;
                padding: 24px;
                position: absolute;
                z-index: 3;
            }

            .enhancedtexts-profile-editor {
                animation: enhancedtexts-modal-in 160ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
                background: var(--modal-background, var(--background-primary, #313338));
                border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
                border-radius: 12px;
                box-shadow: 0 16px 42px rgba(0, 0, 0, 0.42);
                color: var(--text-normal, #dbdee1);
                display: flex;
                flex-direction: column;
                max-height: min(680px, calc(100vh - 72px));
                max-width: 660px;
                overflow: hidden;
                width: 100%;
            }

            .enhancedtexts-profile-description {
                min-height: 220px;
            }

            .enhancedtexts-textarea {
                min-height: 118px;
                resize: vertical;
                white-space: pre-wrap;
            }

            .enhancedtexts-preview {
                min-height: 190px;
            }

            .enhancedtexts-additional-context {
                min-height: 96px;
            }

            .enhancedtexts-age {
                background: var(--background-secondary, #2b2d31);
                border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
                border-radius: 9px;
                padding: 12px;
            }

            .enhancedtexts-age-header {
                align-items: center;
                display: flex;
                justify-content: space-between;
                margin-bottom: 10px;
            }

            .enhancedtexts-age-header .enhancedtexts-label {
                margin-bottom: 0;
            }

            .enhancedtexts-age-value {
                background: rgba(88, 101, 242, 0.2);
                border: 1px solid rgba(88, 101, 242, 0.45);
                border-radius: 999px;
                color: var(--header-primary, #f2f3f5);
                font-size: 12px;
                font-weight: 700;
                min-width: 44px;
                padding: 3px 9px;
                text-align: center;
            }

            .enhancedtexts-age-slider {
                appearance: none;
                background: transparent;
                cursor: pointer;
                display: block;
                margin: 4px 0 8px;
                width: 100%;
            }

            .enhancedtexts-age-slider:disabled {
                cursor: not-allowed;
                opacity: 0.55;
            }

            .enhancedtexts-age-slider::-webkit-slider-runnable-track {
                background: linear-gradient(90deg, var(--brand-500, #5865f2), var(--background-mod-strong, rgba(255, 255, 255, 0.18)));
                border-radius: 999px;
                height: 5px;
            }

            .enhancedtexts-age-slider::-webkit-slider-thumb {
                appearance: none;
                background: var(--brand-360, #949cf7);
                border: 3px solid var(--background-secondary, #2b2d31);
                border-radius: 50%;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
                height: 18px;
                margin-top: -6.5px;
                width: 18px;
            }

            .enhancedtexts-age-slider::-moz-range-track {
                background: var(--background-mod-strong, rgba(255, 255, 255, 0.18));
                border-radius: 999px;
                height: 5px;
            }

            .enhancedtexts-age-slider::-moz-range-progress {
                background: var(--brand-500, #5865f2);
                border-radius: 999px;
                height: 5px;
            }

            .enhancedtexts-age-slider::-moz-range-thumb {
                background: var(--brand-360, #949cf7);
                border: 3px solid var(--background-secondary, #2b2d31);
                border-radius: 50%;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
                height: 14px;
                width: 14px;
            }

            .enhancedtexts-age-labels {
                display: grid;
                grid-template-columns: repeat(12, minmax(0, 1fr));
                gap: 3px;
            }

            .enhancedtexts-age-label {
                background: transparent;
                border: 0;
                border-radius: 5px;
                color: var(--text-muted, #949ba4);
                cursor: pointer;
                font-size: 12px;
                font-weight: 700;
                min-height: 24px;
                padding: 3px 0;
            }

            .enhancedtexts-age-label:hover {
                background: var(--background-mod-subtle, rgba(255, 255, 255, 0.08));
                color: var(--interactive-hover, #dbdee1);
            }

            .enhancedtexts-age-label.active {
                background: rgba(88, 101, 242, 0.24);
                color: #fff;
            }

            .enhancedtexts-reference {
                background: var(--background-secondary, #2b2d31);
                border-left: 3px solid var(--brand-500, #5865f2);
                min-height: 78px;
            }

            .enhancedtexts-reference-wrap {
                position: relative;
            }

            .enhancedtexts-reference-wrap .enhancedtexts-reference {
                padding-right: 48px;
            }

            .enhancedtexts-context-add {
                align-items: center;
                background: var(--brand-500, #5865f2);
                border: 0;
                border-radius: 999px;
                bottom: 10px;
                color: #fff;
                cursor: pointer;
                display: flex;
                font-size: 20px;
                font-weight: 600;
                height: 30px;
                justify-content: center;
                line-height: 1;
                position: absolute;
                right: 10px;
                transition: background-color 120ms ease, filter 120ms ease;
                width: 30px;
            }

            .enhancedtexts-context-add:hover:not(:disabled) {
                background: var(--brand-560, #4752c4);
                filter: brightness(1.05);
            }

            .enhancedtexts-context-add:disabled {
                cursor: not-allowed;
                opacity: 0.55;
            }

            .enhancedtexts-context-summary {
                color: var(--text-muted, #949ba4);
                font-size: 12px;
                margin-top: 6px;
            }

            .enhancedtexts-context-picker-backdrop {
                align-items: center;
                background: rgba(0, 0, 0, 0.56);
                display: flex;
                inset: 0;
                justify-content: center;
                padding: 24px;
                position: absolute;
                z-index: 2;
            }

            .enhancedtexts-context-picker {
                animation: enhancedtexts-modal-in 160ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
                background: var(--modal-background, var(--background-primary, #313338));
                border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
                border-radius: 12px;
                box-shadow: 0 16px 42px rgba(0, 0, 0, 0.42);
                color: var(--text-normal, #dbdee1);
                display: flex;
                flex-direction: column;
                max-height: min(660px, calc(100vh - 72px));
                max-width: 680px;
                overflow: hidden;
                width: 100%;
            }

            .enhancedtexts-context-picker-body {
                overflow-y: auto;
                padding: 18px 20px;
            }

            .enhancedtexts-context-picker-note {
                color: var(--text-muted, #949ba4);
                font-size: 13px;
                line-height: 1.45;
                margin: 0 0 12px;
            }

            .enhancedtexts-context-picker-count {
                color: var(--header-secondary, #b5bac1);
                font-size: 13px;
                font-weight: 700;
                margin-bottom: 10px;
            }

            .enhancedtexts-context-list {
                display: grid;
                gap: 8px;
                max-height: min(430px, calc(100vh - 300px));
                overflow-y: auto;
                padding-right: 4px;
                scrollbar-gutter: stable;
            }

            .enhancedtexts-context-option {
                background: var(--background-secondary, #2b2d31);
                border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
                border-radius: 8px;
                color: var(--text-normal, #dbdee1);
                cursor: pointer;
                min-height: 76px;
                padding: 10px 12px;
                text-align: left;
                transition: background-color 120ms ease, border-color 120ms ease;
                width: 100%;
            }

            .enhancedtexts-context-option:hover {
                background: var(--background-secondary-alt, #2b2d31);
                border-color: var(--interactive-muted, #4e5058);
            }

            .enhancedtexts-context-option.selected {
                background: rgba(88, 101, 242, 0.2);
                border-color: var(--brand-500, #5865f2);
            }

            .enhancedtexts-context-author {
                color: var(--header-primary, #f2f3f5);
                font-size: 13px;
                font-weight: 700;
                margin-bottom: 5px;
            }

            .enhancedtexts-context-content {
                color: var(--text-normal, #dbdee1);
                font-size: 14px;
                line-height: 1.4;
                overflow: hidden;
                white-space: pre-wrap;
                word-break: break-word;
            }

            .enhancedtexts-status {
                border-radius: 4px;
                display: none;
                font-size: 14px;
                margin-bottom: 16px;
                padding: 10px 12px;
            }

            .enhancedtexts-status.visible {
                display: block;
            }

            .enhancedtexts-status.info {
                background: rgba(88, 101, 242, 0.15);
                color: var(--text-normal, #dbdee1);
            }

            .enhancedtexts-status.error {
                background: rgba(242, 63, 67, 0.15);
                color: var(--text-danger, #fa777c);
            }

            .enhancedtexts-progress {
                background: var(--background-mod-strong, rgba(255, 255, 255, 0.12));
                border-radius: 999px;
                display: none;
                height: 6px;
                margin-bottom: 16px;
                overflow: hidden;
                position: relative;
            }

            .enhancedtexts-progress.visible {
                display: block;
            }

            .enhancedtexts-progress-bar {
                background: linear-gradient(90deg, var(--brand-500, #5865f2), #8b9cff);
                border-radius: inherit;
                height: 100%;
                transform: scaleX(0);
                transform-origin: left center;
                transition: transform 280ms ease-out;
                width: 100%;
            }

            .enhancedtexts-progress-label {
                color: var(--text-muted, #949ba4);
                font-size: 12px;
                margin: -9px 0 14px;
                text-align: right;
            }

            .enhancedtexts-modal-footer {
                align-items: center;
                border-top: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                justify-content: flex-end;
                padding: 16px 20px;
            }

            .enhancedtexts-btn {
                background: var(--button-secondary-background, #4e5058);
                border: 0;
                border-radius: 4px;
                color: var(--button-secondary-text, #fff);
                cursor: pointer;
                font-size: 14px;
                font-weight: 500;
                min-height: 38px;
                padding: 8px 16px;
                transition: filter 120ms ease, transform 120ms ease;
            }

            .enhancedtexts-btn:hover {
                filter: brightness(1.08);
            }

            .enhancedtexts-btn.primary {
                background: var(--brand-500, #5865f2);
                color: #fff;
            }

            .enhancedtexts-btn.copy {
                background: var(--brand-500, #5865f2);
                color: #fff;
            }

            .enhancedtexts-btn.insert {
                background: var(--status-positive, #248046);
                color: #fff;
            }

            .enhancedtexts-btn.regenerate {
                background: #f0b232;
                color: #1e1f22;
            }

            .enhancedtexts-btn.add-tokens {
                background: #39ff88;
                box-shadow: 0 0 14px rgba(57, 255, 136, 0.28);
                color: #102318;
                font-weight: 700;
            }

            .enhancedtexts-btn.copy:hover,
            .enhancedtexts-btn.insert:hover,
            .enhancedtexts-btn.regenerate:hover,
            .enhancedtexts-btn.add-tokens:hover {
                filter: brightness(1.12);
                transform: translateY(-1px);
            }

            .enhancedtexts-btn.copy:active,
            .enhancedtexts-btn.insert:active,
            .enhancedtexts-btn.regenerate:active,
            .enhancedtexts-btn.add-tokens:active {
                filter: brightness(0.96);
                transform: translateY(0);
            }

            .enhancedtexts-btn.danger {
                background: var(--status-danger, #da373c);
                color: #fff;
            }

            .enhancedtexts-btn.link {
                background: transparent;
                color: var(--text-link, #00a8fc);
            }

            .enhancedtexts-btn:disabled {
                cursor: not-allowed;
                filter: none;
                opacity: 0.5;
                transform: none;
            }

            .enhancedtexts-settings {
                color: var(--text-normal, #dbdee1);
                max-width: 720px;
                padding: 8px 4px 40px;
            }

            .enhancedtexts-settings-description {
                color: var(--text-muted, #949ba4);
                line-height: 1.45;
                margin: 8px 0 24px;
            }

            .enhancedtexts-setting {
                border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
                padding: 16px 0;
            }

            .enhancedtexts-setting-row {
                align-items: center;
                display: flex;
                gap: 16px;
                justify-content: space-between;
            }

            .enhancedtexts-setting-copy {
                flex: 1;
                min-width: 0;
            }

            .enhancedtexts-setting-title {
                color: var(--header-primary, #f2f3f5);
                font-size: 16px;
                font-weight: 600;
            }

            .enhancedtexts-setting-note {
                color: var(--text-muted, #949ba4);
                font-size: 13px;
                line-height: 1.35;
                margin-top: 4px;
            }

            .enhancedtexts-key-row {
                display: flex;
                gap: 8px;
                margin-top: 10px;
            }

            .enhancedtexts-key-row .enhancedtexts-input {
                flex: 1;
            }

            .enhancedtexts-toggle {
                height: 22px;
                width: 40px;
            }

            .enhancedtexts-settings-actions {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin-top: 20px;
            }

            .enhancedtexts-spinner {
                animation: enhancedtexts-spin 0.8s linear infinite;
                border: 2px solid rgba(255, 255, 255, 0.25);
                border-radius: 50%;
                border-top-color: #fff;
                display: inline-block;
                height: 14px;
                margin-right: 8px;
                vertical-align: -2px;
                width: 14px;
            }

            @keyframes enhancedtexts-spin {
                to { transform: rotate(360deg); }
            }

            @keyframes enhancedtexts-overlay-in {
                from { opacity: 0; }
                to { opacity: 1; }
            }

            @keyframes enhancedtexts-modal-in {
                from {
                    opacity: 0;
                    transform: translateY(10px) scale(0.985);
                }
                to {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
            }

            @media (prefers-reduced-motion: reduce) {
                .enhancedtexts-overlay,
                .enhancedtexts-modal,
                .enhancedtexts-context-picker,
                .enhancedtexts-profile-editor {
                    animation: none;
                }

                .enhancedtexts-progress-bar,
                .enhancedtexts-token-bar-fill,
                .enhancedtexts-btn,
                .enhancedtexts-select,
                .enhancedtexts-custom-select-trigger,
                .enhancedtexts-custom-select-arrow {
                    transition: none;
                }
            }
        `);
    }

    observeDiscord() {
        this.observer = new MutationObserver((mutations) => {
            const externalMutations = mutations.filter((mutation) => !this.isOwnButtonMutation(mutation));
            if (!externalMutations.length) return;

            if (this.buttonToolbar && externalMutations.some((mutation) => (
                mutation.type === "childList"
                && mutation.target === this.buttonToolbar
                && this.hasRelevantToolbarChildChange(mutation)
            ))) {
                this.buttonPlacementDirty = true;
            }

            clearTimeout(this.injectTimer);
            this.injectTimer = setTimeout(() => this.injectButton(), 150);
        });

        this.observer.observe(document.body, {childList: true, subtree: true});
    }

    hasRelevantToolbarChildChange(mutation) {
        const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
        return changedNodes.some((node) => (
            node !== this.button
            && node.nodeType === 1
            && !node.classList?.contains("enhancedtexts-button")
        ));
    }

    isOwnButtonMutation(mutation) {
        if (mutation.type !== "childList") return false;

        const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
        return changedNodes.length > 0 && changedNodes.every((node) => (
            node === this.button
            || (node.nodeType === 1 && node.classList?.contains("enhancedtexts-button"))
        ));
    }

    resolveDiscordModules() {
        this.componentDispatch = this.api.Webpack.getByKeys(
            "dispatchToLastSubscribed",
            "subscribe"
        ) || this.api.Webpack.getByKeys("dispatchToLastSubscribed");
        this.pendingReplyStore = this.api.Webpack.getStore?.("PendingReplyStore")
            || this.api.Webpack.getByKeys("getPendingReply");
        this.messageStore = this.api.Webpack.getStore?.("MessageStore")
            || this.api.Webpack.getByKeys("getMessage", "getMessages");
        this.selectedChannelStore = this.api.Webpack.getStore?.("SelectedChannelStore")
            || this.api.Webpack.getByKeys("getChannelId");
        this.userStore = this.api.Webpack.getStore?.("UserStore")
            || this.api.Webpack.getByKeys("getCurrentUser");

        if (!this.componentDispatch?.dispatchToLastSubscribed) {
            this.api.Logger.warn("Discord ComponentDispatch was not found. Composer insertion will use the native input fallback.");
        }
    }

    findTextbox() {
        const candidates = [
            ...document.querySelectorAll("div[role='textbox'][contenteditable='true']"),
            ...document.querySelectorAll("div[data-slate-editor='true'][contenteditable='true']"),
            ...document.querySelectorAll("textarea")
        ];

        return candidates.find((node) => {
            if (!node.isConnected || node.closest(".enhancedtexts-overlay, .enhancedtexts-settings")) return false;
            const rect = node.getBoundingClientRect();
            if (rect.width < 100 || rect.height < 20) return false;

            const form = node.closest("form");
            const area = node.closest("[class*='channelTextArea'], [class*='textArea'], [class*='composer']");
            return Boolean(form || area);
        }) || null;
    }

    getTextboxText(textbox) {
        if (!textbox) return "";
        if (textbox instanceof HTMLTextAreaElement || textbox instanceof HTMLInputElement) {
            return textbox.value || "";
        }

        return (textbox.innerText || textbox.textContent || "").replace(/\u00a0/g, " ");
    }

    injectButton() {
        if (this.isButtonPlacementStable() && !this.buttonPlacementDirty) return;

        const textbox = this.findTextbox();
        if (!textbox) return;

        const toolbar = this.buttonToolbar?.isConnected && this.button?.parentElement === this.buttonToolbar
            ? this.buttonToolbar
            : this.findComposerToolbar(textbox);
        if (!toolbar) return;

        let button = this.button;
        if (!button?.isConnected) {
            document.querySelectorAll(".enhancedtexts-button").forEach((duplicate) => duplicate.remove());
            if (this.tooltip?.hide) this.tooltip.hide();
            this.tooltip = null;
            button = this.createComposerButton();
            this.button = button;
            this.buttonPlacementDirty = true;
        }

        if (this.buttonPlacementDirty || !this.isButtonPlacementStable() || button.parentElement !== toolbar) {
            this.placeButtonAtVisualLeft(toolbar, button);
        }

        if (!this.tooltip) {
            this.tooltip = this.api.UI.createTooltip(button, "EnhancedTexts", {side: "top"});
        }
    }

    findComposerToolbar(textbox) {
        const root = textbox.closest("form")
            || textbox.closest("[class*='channelTextArea']")
            || textbox.closest("[class*='composer']");
        if (!root) return null;

        const explicitCandidates = [
            ...root.querySelectorAll("[class*='buttons'], [class*='accessory'], [class*='toolbar']")
        ].filter((node) => {
            if (node.contains(textbox) || node.closest(".enhancedtexts-overlay")) return false;
            const controls = node.querySelectorAll("button, [role='button']");
            return controls.length >= 2;
        });

        if (explicitCandidates.length) {
            return explicitCandidates
                .sort((a, b) => this.toolbarScore(b, textbox) - this.toolbarScore(a, textbox))[0];
        }

        const controls = [...root.querySelectorAll("button, [role='button']")]
            .filter((node) => node !== textbox && !node.closest(".enhancedtexts-button"));

        const parents = [...new Set(controls.map((control) => control.parentElement))]
            .filter((parent) => parent && parent !== root && !parent.contains(textbox))
            .filter((parent) => parent.querySelectorAll(":scope > button, :scope > [role='button'], :scope > div").length >= 2);

        return parents
            .sort((a, b) => this.toolbarScore(b, textbox) - this.toolbarScore(a, textbox))[0] || null;
    }

    toolbarScore(toolbar, textbox) {
        const toolbarRect = toolbar.getBoundingClientRect();
        const textboxRect = textbox.getBoundingClientRect();
        const controlCount = toolbar.querySelectorAll("button, [role='button']").length;
        const verticalDistance = Math.abs(
            (toolbarRect.top + toolbarRect.height / 2) - (textboxRect.top + textboxRect.height / 2)
        );
        const horizontalBonus = toolbarRect.left >= textboxRect.left ? 100 : 0;
        return controlCount * 20 + horizontalBonus - verticalDistance;
    }

    createComposerButton() {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "enhancedtexts-button";
        button.setAttribute("aria-label", "EnhancedTexts");
        button.innerHTML = this.getPencilIcon();
        button.addEventListener("click", () => this.handleButtonClick());
        return button;
    }

    placeButtonAtVisualLeft(toolbar, button) {
        const siblings = [...toolbar.children].filter((child) => {
            if (child === button || child.classList?.contains("enhancedtexts-button")) return false;
            const rect = child.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        });

        if (!siblings.length) return;

        const leftmost = siblings.reduce((current, child) => (
            child.getBoundingClientRect().left < current.getBoundingClientRect().left ? child : current
        ));
        const direction = getComputedStyle(toolbar).flexDirection;
        const side = direction === "row-reverse" ? "after" : "before";
        const isAlreadyPlaced = side === "after"
            ? leftmost.nextElementSibling === button
            : leftmost.previousElementSibling === button;

        if (!isAlreadyPlaced) {
            if (side === "after") leftmost.after(button);
            else leftmost.before(button);
        }

        this.buttonToolbar = toolbar;
        this.buttonAnchor = leftmost;
        this.buttonPlacementSide = side;
        this.buttonPlacementDirty = false;
    }

    isButtonPlacementStable() {
        if (!this.button?.isConnected || !this.buttonToolbar?.isConnected || !this.buttonAnchor?.isConnected) {
            return false;
        }

        if (this.button.parentElement !== this.buttonToolbar || this.buttonAnchor.parentElement !== this.buttonToolbar) {
            return false;
        }

        return this.buttonPlacementSide === "after"
            ? this.buttonAnchor.nextElementSibling === this.button
            : this.buttonAnchor.previousElementSibling === this.button;
    }

    getPencilIcon() {
        return `
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path fill="#F6EFD8" d="M3.7 16.8 3 21l4.2-.7L18.9 8.6l-3.5-3.5L3.7 16.8Zm16.4-9.4a1.5 1.5 0 0 0 0-2.1l-1.4-1.4a1.5 1.5 0 0 0-2.1 0l-1.1 1.1L19 8.5l1.1-1.1Z"/>
            </svg>
        `;
    }

    removeButtons() {
        document.querySelectorAll(".enhancedtexts-button").forEach((button) => button.remove());
        if (this.tooltip?.hide) this.tooltip.hide();
        this.tooltip = null;
        this.button = null;
        this.buttonToolbar = null;
        this.buttonAnchor = null;
        this.buttonPlacementSide = null;
        this.buttonPlacementDirty = true;
    }

    handleButtonClick() {
        const textbox = this.findTextbox();
        if (!textbox) {
            this.showToast(this.messages.textboxMissing, "error");
            return;
        }

        const text = this.getTextboxText(textbox).trim();
        if (!text) {
            this.showToast(this.messages.noText, "warning");
            return;
        }

        if (!this.hasApiKey()) {
            this.showToast(this.messages.noKey, "error");
            return;
        }

        const reference = this.settings.logicalMessageReact
            ? this.getReferencedMessageContext(textbox)
            : null;
        const mode = reference
            ? "direct"
            : (this.settings.defaultMode === "ask" ? "announcement" : this.settings.defaultMode);
        this.openModal(text, mode, reference);
    }

    getReferencedMessageContext(textbox) {
        try {
            const channelId = this.selectedChannelStore?.getChannelId?.()
                || textbox.closest("[data-channel-id]")?.dataset.channelId;
            const pending = channelId
                ? this.pendingReplyStore?.getPendingReply?.(channelId)
                : null;

            if (pending) {
                const message = this.resolvePendingReplyMessage(pending, channelId);
                if (message) return this.formatReferencedMessage(message, channelId);
            }
        } catch (error) {
            this.logError("Could not read Discord's pending reply store", error);
        }

        return this.getReferencedMessageFromDom(textbox);
    }

    resolvePendingReplyMessage(pending, fallbackChannelId) {
        if (pending.message?.content !== undefined) return pending.message;
        if (pending.referencedMessage?.content !== undefined) return pending.referencedMessage;

        const reference = pending.messageReference || pending.message_reference || pending;
        const channelId = reference.channelId
            || reference.channel_id
            || pending.channelId
            || fallbackChannelId;
        const messageId = reference.messageId
            || reference.message_id
            || pending.messageId;

        if (!channelId || !messageId) return null;
        return this.messageStore?.getMessage?.(channelId, messageId) || null;
    }

    formatReferencedMessage(message, fallbackChannelId) {
        const author = message.author?.globalName
            || message.author?.displayName
            || message.author?.username
            || message.author?.tag
            || "Unknown user";
        const content = String(message.content || "").trim();
        const attachments = this.toArray(message.attachments)
            .map((attachment) => attachment?.filename || attachment?.name || attachment?.url)
            .filter(Boolean);
        const embeds = this.toArray(message.embeds)
            .flatMap((embed) => [embed?.title, embed?.description])
            .filter(Boolean);
        const parts = [];

        if (content) parts.push(content);
        if (attachments.length) parts.push(`Attachments: ${attachments.join(", ")}`);
        if (embeds.length) parts.push(`Embedded content: ${embeds.join(" | ")}`);

        if (!parts.length) parts.push("[Referenced message contains no readable text.]");

        return {
            channelId: message.channel_id || message.channelId || fallbackChannelId || null,
            messageId: message.id || null,
            author,
            content: parts.join("\n"),
            displayText: `${author}:\n${parts.join("\n")}`,
            source: "discord-store"
        };
    }

    toArray(value) {
        if (!value) return [];
        if (Array.isArray(value)) return value;
        if (typeof value.toArray === "function") return value.toArray();
        if (typeof value.values === "function") return [...value.values()];
        return [];
    }

    getReferencedMessageFromDom(textbox) {
        const root = textbox.closest("form")
            || textbox.closest("[class*='channelTextArea']")
            || textbox.closest("[class*='composer']");
        if (!root) return null;

        const replyBar = root.querySelector(
            "[class*='replyBar'], [class*='replying'], [class*='attachedBars']"
        );
        if (!replyBar) return null;

        const clone = replyBar.cloneNode(true);
        clone.querySelectorAll("button, [role='button'], svg").forEach((node) => node.remove());
        const raw = (clone.innerText || clone.textContent || "")
            .replace(/\s+/g, " ")
            .trim();
        if (!raw) return null;

        const cleaned = raw
            .replace(/^replying to\s+/i, "")
            .replace(/^reply to\s+/i, "")
            .trim();

        return {
            channelId: null,
            messageId: null,
            author: "Referenced user",
            content: cleaned,
            displayText: cleaned,
            source: "reply-preview"
        };
    }

    openModal(originalText, initialMode, reference = null) {
        this.closeModal();

        const overlay = document.createElement("div");
        overlay.className = "enhancedtexts-overlay";
        overlay.setAttribute("role", "presentation");
        overlay.innerHTML = `
            <section class="enhancedtexts-modal" role="dialog" aria-modal="true" aria-labelledby="enhancedtexts-title">
                <header class="enhancedtexts-modal-header">
                    <h2 id="enhancedtexts-title">EnhancedTexts</h2>
                    <button class="enhancedtexts-close" type="button" aria-label="Close">&times;</button>
                </header>
                <div class="enhancedtexts-modal-body">
                    <div class="enhancedtexts-status" role="status" aria-live="polite"></div>
                    <div class="enhancedtexts-progress" role="progressbar" aria-label="Text generation progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                        <div class="enhancedtexts-progress-bar"></div>
                    </div>
                    <div class="enhancedtexts-progress-label" hidden>0%</div>
                    <div class="enhancedtexts-token-panel">
                        <div class="enhancedtexts-token-header">
                            <div class="enhancedtexts-token-text">Checking activation key...</div>
                            <div class="enhancedtexts-token-actions">
                                <button class="enhancedtexts-btn primary enhancedtexts-enter-key" type="button">Enter Key</button>
                                <button class="enhancedtexts-btn add-tokens enhancedtexts-add-tokens" type="button">Add Tokens</button>
                            </div>
                        </div>
                        <div class="enhancedtexts-token-bar" aria-hidden="true">
                            <div class="enhancedtexts-token-bar-fill"></div>
                        </div>
                        <div class="enhancedtexts-token-subtext">Estimated Input Tokens: calculating...</div>
                    </div>
                    <div class="enhancedtexts-field">
                        <label class="enhancedtexts-label" for="enhancedtexts-original">Original text</label>
                        <textarea id="enhancedtexts-original" class="enhancedtexts-textarea"></textarea>
                    </div>
                    <div class="enhancedtexts-field enhancedtexts-reference-field" ${reference ? "" : "hidden"}>
                        <label class="enhancedtexts-label" for="enhancedtexts-reference">Referenced message context</label>
                        <div class="enhancedtexts-reference-wrap">
                            <textarea id="enhancedtexts-reference" class="enhancedtexts-textarea enhancedtexts-reference" readonly></textarea>
                            <button class="enhancedtexts-context-add" type="button" title="Add more context" aria-label="Add more referenced messages">+</button>
                        </div>
                        <div class="enhancedtexts-context-summary" hidden>0 / 10 additional messages selected</div>
                    </div>
                    <div class="enhancedtexts-field">
                        <label class="enhancedtexts-label" for="enhancedtexts-additional-context">Additional Context</label>
                        <textarea id="enhancedtexts-additional-context" class="enhancedtexts-textarea enhancedtexts-additional-context" placeholder="Additional Context..."></textarea>
                    </div>
                    <div class="enhancedtexts-field">
                        <div class="enhancedtexts-age">
                            <div class="enhancedtexts-age-header">
                                <label class="enhancedtexts-label" for="enhancedtexts-age-slider">Age Personalisation</label>
                                <span class="enhancedtexts-age-value">PRO</span>
                            </div>
                            <input id="enhancedtexts-age-slider" class="enhancedtexts-age-slider" type="range" min="0" max="11" step="1" value="11" aria-label="Age Personalisation">
                            <div class="enhancedtexts-age-labels" aria-hidden="false">
                                ${this.getAgeOptions().map((option, index) => `
                                    <button class="enhancedtexts-age-label" type="button" data-index="${index}" data-value="${option.value}">${option.label}</button>
                                `).join("")}
                            </div>
                        </div>
                    </div>
                    <div class="enhancedtexts-field">
                        <label class="enhancedtexts-label" id="enhancedtexts-mode-label">Rewrite mode</label>
                        <div id="enhancedtexts-mode" class="enhancedtexts-custom-select" data-value="announcement">
                            <button class="enhancedtexts-custom-select-trigger" type="button" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="enhancedtexts-mode-label enhancedtexts-mode-value">
                                <span id="enhancedtexts-mode-value">Discord Announcement</span>
                                <span class="enhancedtexts-custom-select-arrow" aria-hidden="true"></span>
                            </button>
                            <div class="enhancedtexts-custom-select-menu" role="listbox" aria-labelledby="enhancedtexts-mode-label" tabindex="-1">
                                <button class="enhancedtexts-custom-select-option" type="button" role="option" data-value="announcement" aria-selected="true">Discord Announcement</button>
                                <button class="enhancedtexts-custom-select-option" type="button" role="option" data-value="support" aria-selected="false">Support Ticket</button>
                                <button class="enhancedtexts-custom-select-option" type="button" role="option" data-value="direct" aria-selected="false">Direct Message</button>
                            </div>
                        </div>
                    </div>
                    <div class="enhancedtexts-field">
                        <label class="enhancedtexts-label" id="enhancedtexts-profile-label">Profile</label>
                        <div id="enhancedtexts-profile" class="enhancedtexts-custom-select enhancedtexts-profile-select" data-value="none">
                            <button class="enhancedtexts-custom-select-trigger" type="button" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="enhancedtexts-profile-label enhancedtexts-profile-value">
                                <span id="enhancedtexts-profile-value">No Profile</span>
                                <span class="enhancedtexts-custom-select-arrow" aria-hidden="true"></span>
                            </button>
                            <div class="enhancedtexts-custom-select-menu enhancedtexts-profile-menu" role="listbox" aria-labelledby="enhancedtexts-profile-label">
                                <div class="enhancedtexts-profile-options">
                                    ${this.renderProfileOptions()}
                                </div>
                                <div class="enhancedtexts-profile-add">
                                    <button class="enhancedtexts-btn primary enhancedtexts-add-profile" type="button">Add Profile</button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="enhancedtexts-field">
                        <label class="enhancedtexts-label" id="enhancedtexts-language-label">Language</label>
                        <div id="enhancedtexts-language" class="enhancedtexts-custom-select enhancedtexts-language-select" data-value="english">
                            <button class="enhancedtexts-custom-select-trigger" type="button" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="enhancedtexts-language-label enhancedtexts-language-value">
                                <span id="enhancedtexts-language-value">English</span>
                                <span class="enhancedtexts-custom-select-arrow" aria-hidden="true"></span>
                            </button>
                            <div class="enhancedtexts-custom-select-menu enhancedtexts-language-menu" role="listbox" aria-labelledby="enhancedtexts-language-label">
                                <input class="enhancedtexts-language-search" type="text" placeholder="Search language..." autocomplete="off" spellcheck="false" aria-label="Search languages">
                                <div class="enhancedtexts-language-options">
                                    <button class="enhancedtexts-custom-select-option" type="button" role="option" data-value="german" aria-selected="false">German</button>
                                    <button class="enhancedtexts-custom-select-option" type="button" role="option" data-value="english" aria-selected="true">English</button>
                                    <button class="enhancedtexts-custom-select-option" type="button" role="option" data-value="french" aria-selected="false">French</button>
                                    <button class="enhancedtexts-custom-select-option" type="button" role="option" data-value="russian" aria-selected="false">Russian</button>
                                    <button class="enhancedtexts-custom-select-option" type="button" role="option" data-value="spanish" aria-selected="false">Spanish</button>
                                    <button class="enhancedtexts-custom-select-option" type="button" role="option" data-value="chinese-mandarin" aria-selected="false">Chinese (Mandarin)</button>
                                    <button class="enhancedtexts-custom-select-option" type="button" role="option" data-value="hindi" aria-selected="false">Hindi</button>
                                    <button class="enhancedtexts-custom-select-option" type="button" role="option" data-value="arabic" aria-selected="false">Arabic</button>
                                    <button class="enhancedtexts-custom-select-option" type="button" role="option" data-value="japanese" aria-selected="false">Japanese</button>
                                    <button class="enhancedtexts-custom-select-option" type="button" role="option" data-value="portuguese" aria-selected="false">Portuguese</button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="enhancedtexts-field">
                        <label class="enhancedtexts-label" for="enhancedtexts-preview">Improved text</label>
                        <textarea id="enhancedtexts-preview" class="enhancedtexts-textarea enhancedtexts-preview" placeholder="Your improved text will appear here." readonly></textarea>
                    </div>
                </div>
                <footer class="enhancedtexts-modal-footer">
                    <button class="enhancedtexts-btn link enhancedtexts-cancel" type="button">Cancel</button>
                    <button class="enhancedtexts-btn copy enhancedtexts-copy" type="button" disabled>Copy</button>
                    <button class="enhancedtexts-btn insert enhancedtexts-insert" type="button" disabled>Insert into TextBox</button>
                    <button class="enhancedtexts-btn regenerate enhancedtexts-regenerate" type="button" hidden>Regenerate</button>
                    <button class="enhancedtexts-btn primary enhancedtexts-generate" type="button">Generate</button>
                </footer>
            </section>
        `;

        const original = overlay.querySelector("#enhancedtexts-original");
        const referenceInput = overlay.querySelector("#enhancedtexts-reference");
        const ageSlider = overlay.querySelector("#enhancedtexts-age-slider");
        const mode = overlay.querySelector("#enhancedtexts-mode");
        const profile = overlay.querySelector("#enhancedtexts-profile");
        const language = overlay.querySelector("#enhancedtexts-language");
        const preview = overlay.querySelector("#enhancedtexts-preview");
        const close = overlay.querySelector(".enhancedtexts-close");
        const cancel = overlay.querySelector(".enhancedtexts-cancel");
        const generate = overlay.querySelector(".enhancedtexts-generate");
        const regenerate = overlay.querySelector(".enhancedtexts-regenerate");
        const copy = overlay.querySelector(".enhancedtexts-copy");
        const insert = overlay.querySelector(".enhancedtexts-insert");
        const addContext = overlay.querySelector(".enhancedtexts-context-add");
        const enterKey = overlay.querySelector(".enhancedtexts-enter-key");
        const addTokens = overlay.querySelector(".enhancedtexts-add-tokens");

        original.value = originalText;
        overlay.logicalMessageContext = reference ? {...reference, additionalMessages: []} : null;
        this.updateReferencedMessageDisplay(overlay);
        this.initializeAgeSlider(overlay, this.settings.agePersonalisation);
        this.initializeModeDropdown(mode, initialMode);
        this.initializeProfileDropdown(profile, this.settings.selectedProfileId);
        this.initializeLanguageDropdown(language, this.settings.outputLanguage);

        close.addEventListener("click", () => this.closeModal());
        cancel.addEventListener("click", () => this.closeModal());
        generate.addEventListener("click", () => this.generateFromModal(overlay));
        regenerate.addEventListener("click", () => this.generateFromModal(overlay));
        copy.addEventListener("click", () => this.copyText(preview.value));
        insert.addEventListener("click", () => {
            if (this.insertIntoTextbox(preview.value)) this.closeModal();
        });
        addContext?.addEventListener("click", () => this.openAdditionalContextPicker(overlay));
        enterKey?.addEventListener("click", () => this.openEnterActivationKeyModal(overlay));
        addTokens?.addEventListener("click", () => this.openAddTokensModal(overlay));
        [original, overlay.querySelector("#enhancedtexts-additional-context")].forEach((input) => {
            input?.addEventListener("input", () => this.updateTokenEstimate(overlay));
        });

        overlay.addEventListener("mousedown", (event) => {
            if (!event.target.closest(".enhancedtexts-custom-select")) {
                this.closeModeDropdown(mode);
                this.closeModeDropdown(profile);
                this.closeModeDropdown(language);
            }
            if (event.target === overlay && !this.isGenerating) this.closeModal();
        });

        overlay.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && !this.isGenerating) this.closeModal();
        });

        document.body.appendChild(overlay);
        this.activeModal = overlay;
        this.updateTokenDisplay(overlay);
        this.updateTokenEstimate(overlay);
        this.refreshTokenStatus(overlay);
        mode.querySelector(".enhancedtexts-custom-select-trigger").focus();
    }

    getAgeOptions() {
        return [
            {value: "6", label: "6"},
            {value: "7", label: "7"},
            {value: "8", label: "8"},
            {value: "9", label: "9"},
            {value: "10", label: "10"},
            {value: "11", label: "11"},
            {value: "12", label: "12"},
            {value: "13", label: "13"},
            {value: "14", label: "14"},
            {value: "15", label: "15"},
            {value: "16", label: "16"},
            {value: "pro", label: "PRO"}
        ];
    }

    normalizeAgePersonalisation(value) {
        const normalized = String(value || "pro").toLowerCase();
        return this.getAgeOptions().some((option) => option.value === normalized)
            ? normalized
            : "pro";
    }

    initializeAgeSlider(modal, initialValue) {
        const options = this.getAgeOptions();
        const slider = modal.querySelector("#enhancedtexts-age-slider");
        const value = modal.querySelector(".enhancedtexts-age-value");
        const labels = [...modal.querySelectorAll(".enhancedtexts-age-label")];
        if (!slider || !value || !labels.length) return;

        const setValue = (nextValue, save = true) => {
            const normalized = this.normalizeAgePersonalisation(nextValue);
            const index = Math.max(0, options.findIndex((option) => option.value === normalized));
            slider.value = String(index);
            slider.dataset.value = normalized;
            value.textContent = options[index].label;
            labels.forEach((label, labelIndex) => {
                label.classList.toggle("active", labelIndex === index);
                label.setAttribute("aria-current", labelIndex === index ? "true" : "false");
            });

            if (save) {
                this.settings.agePersonalisation = normalized;
                this.saveSettings();
            }
            this.updateTokenEstimate(modal);
        };

        slider.addEventListener("input", () => {
            const option = options[Number(slider.value)] || options[options.length - 1];
            setValue(option.value);
        });

        labels.forEach((label) => {
            label.addEventListener("click", () => {
                if (slider.disabled) return;
                const option = options[Number(label.dataset.index)] || options[options.length - 1];
                setValue(option.value);
                slider.focus();
            });
        });

        setValue(initialValue, false);
    }

    setAgeSliderDisabled(modal, disabled) {
        const slider = modal.querySelector("#enhancedtexts-age-slider");
        if (slider) slider.disabled = disabled;
        modal.querySelectorAll(".enhancedtexts-age-label").forEach((label) => {
            label.disabled = disabled;
        });
    }

    initializeModeDropdown(dropdown, initialValue) {
        const trigger = dropdown.querySelector(".enhancedtexts-custom-select-trigger");
        const options = [...dropdown.querySelectorAll(".enhancedtexts-custom-select-option")];

        const selectOption = (option, returnFocus = true) => {
            if (!option || dropdown.dataset.disabled === "true") return;
            dropdown.dataset.value = option.dataset.value;
            trigger.querySelector("span").textContent = option.textContent;
            options.forEach((item) => {
                item.setAttribute("aria-selected", String(item === option));
                item.classList.remove("keyboard-active");
            });
            this.closeModeDropdown(dropdown);
            this.updateTokenEstimate(dropdown.closest(".enhancedtexts-overlay"));
            if (returnFocus) trigger.focus();
        };

        const moveActive = (direction) => {
            const current = options.findIndex((option) => option.classList.contains("keyboard-active"));
            const selected = options.findIndex((option) => option.getAttribute("aria-selected") === "true");
            const base = current >= 0 ? current : selected;
            const next = (base + direction + options.length) % options.length;
            options.forEach((option, index) => option.classList.toggle("keyboard-active", index === next));
            options[next].scrollIntoView({block: "nearest"});
        };

        trigger.addEventListener("click", () => {
            if (dropdown.dataset.disabled === "true") return;
            const open = !dropdown.classList.contains("open");
            this.closeModeDropdown(dropdown.closest(".enhancedtexts-modal")?.querySelector("#enhancedtexts-profile"));
            this.closeModeDropdown(dropdown.closest(".enhancedtexts-modal")?.querySelector("#enhancedtexts-language"));
            this.closeModeDropdown(dropdown);
            if (open) {
                dropdown.classList.add("open");
                trigger.setAttribute("aria-expanded", "true");
                const selected = options.find((option) => option.getAttribute("aria-selected") === "true");
                selected?.classList.add("keyboard-active");
            }
        });

        trigger.addEventListener("keydown", (event) => {
            if (dropdown.dataset.disabled === "true") return;

            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (!dropdown.classList.contains("open")) trigger.click();
                moveActive(event.key === "ArrowDown" ? 1 : -1);
            } else if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (!dropdown.classList.contains("open")) trigger.click();
                else selectOption(options.find((option) => option.classList.contains("keyboard-active")));
            } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                this.closeModeDropdown(dropdown);
            }
        });

        options.forEach((option) => {
            option.addEventListener("click", () => selectOption(option));
            option.addEventListener("mouseenter", () => {
                options.forEach((item) => item.classList.toggle("keyboard-active", item === option));
            });
        });

        selectOption(options.find((option) => option.dataset.value === initialValue) || options[0], false);
    }

    renderProfileOptions() {
        return this.settings.profiles.map((profile) => `
            <div class="enhancedtexts-custom-select-option enhancedtexts-profile-option" role="option" tabindex="-1" data-value="${this.escapeHtml(profile.id)}" aria-selected="false">
                <span class="enhancedtexts-profile-name">${this.escapeHtml(profile.name)}</span>
                <button class="enhancedtexts-profile-edit" type="button" title="Edit profile" aria-label="Edit ${this.escapeHtml(profile.name)}" ${profile.locked ? "hidden" : ""}>
                    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" width="15" height="15">
                        <path fill="currentColor" d="M3 14.6V17h2.4l8.2-8.2-2.4-2.4L3 14.6Zm12.5-7.7c.3-.3.3-.8 0-1.1l-1.3-1.3a.8.8 0 0 0-1.1 0l-1 1 2.4 2.4 1-1Z"/>
                    </svg>
                </button>
            </div>
        `).join("");
    }

    initializeProfileDropdown(dropdown, initialValue) {
        const trigger = dropdown.querySelector(".enhancedtexts-custom-select-trigger");
        const optionsRoot = dropdown.querySelector(".enhancedtexts-profile-options");
        const addProfile = dropdown.querySelector(".enhancedtexts-add-profile");

        const refreshOptions = () => {
            optionsRoot.innerHTML = this.renderProfileOptions();
            bindOptions();
            const selected = this.getSelectedProfile();
            this.selectProfileOption(dropdown, selected?.id || "none", false);
        };

        const bindOptions = () => {
            const options = [...dropdown.querySelectorAll(".enhancedtexts-profile-option")];
            options.forEach((option) => {
                option.addEventListener("click", () => this.selectProfileOption(dropdown, option.dataset.value));
                option.addEventListener("mouseenter", () => {
                    options.forEach((item) => item.classList.toggle("keyboard-active", item === option));
                });
                option.querySelector(".enhancedtexts-profile-edit")?.addEventListener("click", (event) => {
                    event.stopPropagation();
                    this.closeModeDropdown(dropdown);
                    this.openProfileEditor(dropdown.closest(".enhancedtexts-overlay"), option.dataset.value, refreshOptions);
                });
            });
        };

        const moveActive = (direction) => {
            const options = [...dropdown.querySelectorAll(".enhancedtexts-profile-option")];
            if (!options.length) return;
            const current = options.findIndex((option) => option.classList.contains("keyboard-active"));
            const selected = options.findIndex((option) => option.getAttribute("aria-selected") === "true");
            const base = current >= 0 ? current : selected;
            const next = (base + direction + options.length) % options.length;
            options.forEach((option, index) => option.classList.toggle("keyboard-active", index === next));
            options[next].scrollIntoView({block: "nearest"});
        };

        trigger.addEventListener("click", () => {
            if (dropdown.dataset.disabled === "true") return;
            const open = !dropdown.classList.contains("open");
            const modal = dropdown.closest(".enhancedtexts-modal");
            this.closeModeDropdown(modal?.querySelector("#enhancedtexts-mode"));
            this.closeModeDropdown(modal?.querySelector("#enhancedtexts-language"));
            this.closeModeDropdown(dropdown);
            if (open) {
                dropdown.classList.add("open");
                trigger.setAttribute("aria-expanded", "true");
                const selected = dropdown.querySelector(".enhancedtexts-profile-option[aria-selected='true']");
                selected?.classList.add("keyboard-active");
            }
        });

        trigger.addEventListener("keydown", (event) => {
            if (dropdown.dataset.disabled === "true") return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (!dropdown.classList.contains("open")) trigger.click();
                moveActive(event.key === "ArrowDown" ? 1 : -1);
            } else if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (!dropdown.classList.contains("open")) trigger.click();
                else this.selectProfileOption(dropdown, dropdown.querySelector(".enhancedtexts-profile-option.keyboard-active")?.dataset.value);
            } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                this.closeModeDropdown(dropdown);
            }
        });

        addProfile.addEventListener("click", (event) => {
            event.stopPropagation();
            const profile = this.createProfile();
            this.settings.profiles.push(profile);
            this.settings.selectedProfileId = profile.id;
            this.saveSettings();
            refreshOptions();
            this.closeModeDropdown(dropdown);
            this.openProfileEditor(dropdown.closest(".enhancedtexts-overlay"), profile.id, refreshOptions);
        });

        bindOptions();
        this.selectProfileOption(dropdown, initialValue, false);
    }

    selectProfileOption(dropdown, profileId, returnFocus = true) {
        const profile = this.getProfileById(profileId) || this.getProfileById("none");
        if (!profile || dropdown.dataset.disabled === "true") return;

        dropdown.dataset.value = profile.id;
        dropdown.querySelector(".enhancedtexts-custom-select-trigger span").textContent = profile.name;
        dropdown.querySelectorAll(".enhancedtexts-profile-option").forEach((option) => {
            option.setAttribute("aria-selected", String(option.dataset.value === profile.id));
            option.classList.remove("keyboard-active");
        });
        this.settings.selectedProfileId = profile.id;
        this.saveSettings();
        this.closeModeDropdown(dropdown);
        this.updateTokenEstimate(dropdown.closest(".enhancedtexts-overlay"));
        if (returnFocus) dropdown.querySelector(".enhancedtexts-custom-select-trigger").focus();
    }

    openProfileEditor(overlay, profileId, onChange) {
        const profile = this.getProfileById(profileId);
        if (!overlay || !profile || profile.locked) return;

        overlay.querySelector(".enhancedtexts-profile-editor-backdrop")?.remove();

        const editor = document.createElement("div");
        editor.className = "enhancedtexts-profile-editor-backdrop";
        editor.setAttribute("role", "presentation");
        editor.innerHTML = `
            <section class="enhancedtexts-profile-editor" role="dialog" aria-modal="true" aria-labelledby="enhancedtexts-profile-editor-title">
                <header class="enhancedtexts-modal-header">
                    <h2 id="enhancedtexts-profile-editor-title">Edit Profile</h2>
                    <button class="enhancedtexts-close enhancedtexts-profile-editor-close" type="button" aria-label="Close">&times;</button>
                </header>
                <div class="enhancedtexts-context-picker-body">
                    <div class="enhancedtexts-field">
                        <label class="enhancedtexts-label" for="enhancedtexts-profile-name-input">Profile Name</label>
                        <input id="enhancedtexts-profile-name-input" class="enhancedtexts-input" type="text" maxlength="64">
                    </div>
                    <div class="enhancedtexts-field">
                        <label class="enhancedtexts-label" for="enhancedtexts-profile-description-input">Profile Description</label>
                        <textarea id="enhancedtexts-profile-description-input" class="enhancedtexts-textarea enhancedtexts-profile-description" placeholder="Describe your role, project, terminology, ranks, communication style, and usual context."></textarea>
                    </div>
                </div>
                <footer class="enhancedtexts-modal-footer">
                    <button class="enhancedtexts-btn danger enhancedtexts-profile-delete" type="button">Delete</button>
                    <button class="enhancedtexts-btn link enhancedtexts-profile-editor-cancel" type="button">Cancel</button>
                    <button class="enhancedtexts-btn primary enhancedtexts-profile-save" type="button">Save Profile</button>
                </footer>
            </section>
        `;

        const nameInput = editor.querySelector("#enhancedtexts-profile-name-input");
        const descriptionInput = editor.querySelector("#enhancedtexts-profile-description-input");
        const closeEditor = () => editor.remove();

        nameInput.value = profile.name;
        descriptionInput.value = profile.description || "";

        editor.querySelector(".enhancedtexts-profile-editor-close").addEventListener("click", closeEditor);
        editor.querySelector(".enhancedtexts-profile-editor-cancel").addEventListener("click", closeEditor);
        editor.querySelector(".enhancedtexts-profile-save").addEventListener("click", () => {
            profile.name = nameInput.value.trim() || "Profile";
            profile.description = descriptionInput.value.trim();
            this.saveSettings();
            onChange?.();
            this.showToast("Profile saved.", "success");
            closeEditor();
        });
        editor.querySelector(".enhancedtexts-profile-delete").addEventListener("click", () => {
            if (!confirm(`Delete "${profile.name}"? This cannot be undone.`)) return;
            this.deleteProfile(profile.id);
            this.saveSettings();
            onChange?.();
            this.showToast("Profile deleted.", "success");
            closeEditor();
        });
        editor.addEventListener("mousedown", (event) => {
            event.stopPropagation();
            if (event.target === editor) closeEditor();
        });
        editor.addEventListener("keydown", (event) => {
            event.stopPropagation();
            if (event.key === "Escape") closeEditor();
        });

        overlay.querySelector(".enhancedtexts-modal")?.appendChild(editor);
        nameInput.focus();
        nameInput.select();
    }

    initializeLanguageDropdown(dropdown, initialValue) {
        const trigger = dropdown.querySelector(".enhancedtexts-custom-select-trigger");
        const search = dropdown.querySelector(".enhancedtexts-language-search");
        const options = [...dropdown.querySelectorAll(".enhancedtexts-custom-select-option")];

        const visibleOptions = () => options.filter((option) => !option.hidden);
        const setActive = (option) => {
            options.forEach((item) => item.classList.toggle("keyboard-active", item === option));
            option?.scrollIntoView({block: "nearest"});
        };
        const selectOption = (option, returnFocus = true) => {
            if (!option || option.hidden || dropdown.dataset.disabled === "true") return;
            dropdown.dataset.value = option.dataset.value;
            trigger.querySelector("span").textContent = option.textContent;
            options.forEach((item) => {
                item.setAttribute("aria-selected", String(item === option));
                item.classList.remove("keyboard-active");
            });
            this.settings.outputLanguage = option.dataset.value;
            this.saveSettings();
            search.value = "";
            options.forEach((item) => item.hidden = false);
            this.closeModeDropdown(dropdown);
            this.updateTokenEstimate(dropdown.closest(".enhancedtexts-overlay"));
            if (returnFocus) trigger.focus();
        };
        const filterOptions = () => {
            const query = search.value.trim().toLocaleLowerCase();
            options.forEach((option) => {
                option.hidden = Boolean(query) && !option.textContent.toLocaleLowerCase().includes(query);
            });
            setActive(visibleOptions()[0] || null);
        };
        const moveActive = (direction) => {
            const visible = visibleOptions();
            if (!visible.length) return;
            const current = visible.findIndex((option) => option.classList.contains("keyboard-active"));
            const next = (current + direction + visible.length) % visible.length;
            setActive(visible[next]);
        };
        const openDropdown = () => {
            if (dropdown.dataset.disabled === "true") return;
            const modal = dropdown.closest(".enhancedtexts-modal");
            this.closeModeDropdown(modal?.querySelector("#enhancedtexts-mode"));
            this.closeModeDropdown(modal?.querySelector("#enhancedtexts-profile"));
            dropdown.classList.add("open");
            trigger.setAttribute("aria-expanded", "true");
            search.value = "";
            options.forEach((option) => option.hidden = false);
            const selected = options.find((option) => option.getAttribute("aria-selected") === "true");
            setActive(selected);
            requestAnimationFrame(() => search.focus());
        };

        trigger.addEventListener("click", () => {
            if (dropdown.classList.contains("open")) this.closeModeDropdown(dropdown);
            else openDropdown();
        });

        trigger.addEventListener("keydown", (event) => {
            if (dropdown.dataset.disabled === "true") return;
            if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
                event.preventDefault();
                openDropdown();
            } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                event.preventDefault();
                openDropdown();
                search.value = event.key;
                filterOptions();
            }
        });

        search.addEventListener("input", filterOptions);
        search.addEventListener("keydown", (event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                moveActive(event.key === "ArrowDown" ? 1 : -1);
            } else if (event.key === "Enter") {
                event.preventDefault();
                selectOption(options.find((option) => option.classList.contains("keyboard-active")) || visibleOptions()[0]);
            } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                this.closeModeDropdown(dropdown);
                trigger.focus();
            }
        });

        options.forEach((option) => {
            option.addEventListener("click", () => selectOption(option));
            option.addEventListener("mouseenter", () => setActive(option));
        });

        selectOption(options.find((option) => option.dataset.value === initialValue) || options[1], false);
    }

    closeModeDropdown(dropdown) {
        if (!dropdown) return;
        dropdown.classList.remove("open");
        dropdown.querySelector(".enhancedtexts-custom-select-trigger")?.setAttribute("aria-expanded", "false");
        dropdown.querySelectorAll(".enhancedtexts-custom-select-option")
            .forEach((option) => option.classList.remove("keyboard-active"));
    }

    setModeDropdownDisabled(dropdown, disabled) {
        dropdown.dataset.disabled = String(disabled);
        dropdown.querySelector(".enhancedtexts-custom-select-trigger").disabled = disabled;
        if (disabled) this.closeModeDropdown(dropdown);
    }

    updateReferencedMessageDisplay(modal) {
        const reference = modal.logicalMessageContext || null;
        const input = modal.querySelector("#enhancedtexts-reference");
        const summary = modal.querySelector(".enhancedtexts-context-summary");
        if (!reference || !input) return;

        const additional = Array.isArray(reference?.additionalMessages)
            ? reference.additionalMessages
            : [];
        const lines = [reference.displayText || `${reference.author || "Unknown user"}:\n${reference.content || ""}`];

        if (additional.length) {
            lines.push(
                "",
                `Additional selected context (${additional.length} / ${this.maxAdditionalContextMessages}):`,
                ...additional.map((message, index) => (
                    `${index + 1}. ${message.author || "Unknown user"}:\n${message.content || ""}`
                ))
            );
        }

        input.value = lines.join("\n");
        if (summary) {
            summary.hidden = false;
            summary.textContent = `${additional.length} / ${this.maxAdditionalContextMessages} additional messages selected`;
        }
    }

    openAdditionalContextPicker(modal) {
        const reference = modal.logicalMessageContext || null;
        if (!reference) return;

        const candidates = this.getAdditionalContextCandidates(reference);
        if (!candidates.length) {
            this.setModalStatus(modal, "No additional nearby messages were found in Discord's cached context.", "info");
            return;
        }

        modal.querySelector(".enhancedtexts-context-picker-backdrop")?.remove();

        const selectedIds = new Set(
            (reference.additionalMessages || [])
                .map((message) => message.messageId)
                .filter(Boolean)
                .map(String)
        );
        const picker = document.createElement("div");
        picker.className = "enhancedtexts-context-picker-backdrop";
        picker.setAttribute("role", "presentation");
        picker.innerHTML = `
            <section class="enhancedtexts-context-picker" role="dialog" aria-modal="true" aria-labelledby="enhancedtexts-context-title">
                <header class="enhancedtexts-modal-header">
                    <h2 id="enhancedtexts-context-title">Additional Message Context</h2>
                    <button class="enhancedtexts-close enhancedtexts-context-close" type="button" aria-label="Close">&times;</button>
                </header>
                <div class="enhancedtexts-context-picker-body">
                    <p class="enhancedtexts-context-picker-note">
                        Select up to ${this.maxAdditionalContextMessages} nearby messages. The original reacted message is already included automatically.
                    </p>
                    <div class="enhancedtexts-context-picker-count">0 / ${this.maxAdditionalContextMessages} selected</div>
                    <div class="enhancedtexts-context-list">
                        ${candidates.map((message) => `
                            <button class="enhancedtexts-context-option" type="button" data-message-id="${this.escapeHtml(String(message.messageId || ""))}">
                                <div class="enhancedtexts-context-author">${this.escapeHtml(message.author || "Unknown user")}</div>
                                <div class="enhancedtexts-context-content">${this.escapeHtml(this.truncatePreview(message.content || "", 100))}</div>
                            </button>
                        `).join("")}
                    </div>
                </div>
                <footer class="enhancedtexts-modal-footer">
                    <button class="enhancedtexts-btn link enhancedtexts-context-cancel" type="button">Cancel</button>
                    <button class="enhancedtexts-btn primary enhancedtexts-context-apply" type="button">Use Selected Context</button>
                </footer>
            </section>
        `;

        const count = picker.querySelector(".enhancedtexts-context-picker-count");
        const options = [...picker.querySelectorAll(".enhancedtexts-context-option")];
        const refresh = () => {
            options.forEach((option) => option.classList.toggle("selected", selectedIds.has(option.dataset.messageId)));
            count.textContent = `${selectedIds.size} / ${this.maxAdditionalContextMessages} selected`;
        };
        const closePicker = () => picker.remove();

        options.forEach((option) => {
            option.addEventListener("click", () => {
                const id = option.dataset.messageId;
                if (selectedIds.has(id)) {
                    selectedIds.delete(id);
                } else if (selectedIds.size >= this.maxAdditionalContextMessages) {
                    this.setModalStatus(modal, `You can select up to ${this.maxAdditionalContextMessages} additional context messages.`, "error");
                    return;
                } else {
                    selectedIds.add(id);
                }
                refresh();
            });
        });

        picker.querySelector(".enhancedtexts-context-close").addEventListener("click", closePicker);
        picker.querySelector(".enhancedtexts-context-cancel").addEventListener("click", closePicker);
        picker.querySelector(".enhancedtexts-context-apply").addEventListener("click", () => {
            reference.additionalMessages = candidates.filter((message) => selectedIds.has(String(message.messageId)));
            this.updateReferencedMessageDisplay(modal);
            this.updateTokenEstimate(modal);
            closePicker();
        });
        picker.addEventListener("mousedown", (event) => {
            event.stopPropagation();
            if (event.target === picker) closePicker();
        });
        picker.addEventListener("keydown", (event) => {
            event.stopPropagation();
            if (event.key === "Escape") closePicker();
        });

        modal.querySelector(".enhancedtexts-modal")?.appendChild(picker);
        refresh();
        picker.querySelector(".enhancedtexts-context-option")?.focus();
    }

    getAdditionalContextCandidates(reference) {
        if (!reference?.channelId || !reference?.messageId) return [];

        const messages = this.getCachedChannelMessages(reference.channelId);
        const index = messages.findIndex((message) => String(message.id) === String(reference.messageId));
        if (index < 0) return [];

        const isSelectable = (message) => (
            String(message.id) !== String(reference.messageId)
        );
        const formatSelectable = (message) => {
            const formatted = this.formatAdditionalContextMessage(message, reference.channelId);
            if (!formatted?.messageId || !formatted.content) return null;
            if (formatted.content.startsWith("[Referenced message contains no readable text.]")) return null;
            return formatted;
        };

        const before = messages
            .slice(0, index)
            .reverse()
            .filter(isSelectable)
            .map(formatSelectable)
            .filter(Boolean)
            .slice(0, Math.floor(this.maxAdditionalContextMessages / 2))
            .reverse();
        const after = messages
            .slice(index + 1)
            .filter(isSelectable)
            .map(formatSelectable)
            .filter(Boolean)
            .slice(0, Math.ceil(this.maxAdditionalContextMessages / 2));

        return [...before, ...after];
    }

    getCachedChannelMessages(channelId) {
        const collection = this.messageStore?.getMessages?.(channelId);
        const messages = this.normalizeMessageCollection(collection);
        const unique = new Map();

        messages.forEach((message) => {
            if (message?.id && !unique.has(String(message.id))) unique.set(String(message.id), message);
        });

        return [...unique.values()].sort((a, b) => this.compareMessagesChronologically(a, b));
    }

    normalizeMessageCollection(collection) {
        if (!collection) return [];
        if (Array.isArray(collection)) return collection;
        if (typeof collection.toArray === "function") return collection.toArray();
        if (typeof collection.values === "function") return [...collection.values()];
        if (Array.isArray(collection._array)) return collection._array;
        if (Array.isArray(collection._orderedMessages)) return collection._orderedMessages;
        if (collection._map) return Object.values(collection._map);
        if (collection._messages) return this.normalizeMessageCollection(collection._messages);
        if (collection.messages) return this.normalizeMessageCollection(collection.messages);
        return Object.values(collection).filter((value) => value?.id && value?.author);
    }

    compareMessagesChronologically(a, b) {
        const aTime = this.getMessageTimestamp(a);
        const bTime = this.getMessageTimestamp(b);
        if (aTime !== null && bTime !== null && aTime !== bTime) return aTime - bTime;

        try {
            const aId = BigInt(a.id);
            const bId = BigInt(b.id);
            return aId < bId ? -1 : aId > bId ? 1 : 0;
        } catch {
            return String(a.id).localeCompare(String(b.id));
        }
    }

    getMessageTimestamp(message) {
        const timestamp = message?.timestamp || message?.createdTimestamp || message?.timestampMillis;
        if (timestamp instanceof Date) return timestamp.getTime();
        if (typeof timestamp === "number") return timestamp;
        if (typeof timestamp === "string") {
            const parsed = Date.parse(timestamp);
            return Number.isNaN(parsed) ? null : parsed;
        }
        return null;
    }

    formatAdditionalContextMessage(message, fallbackChannelId) {
        const formatted = this.formatReferencedMessage(message, fallbackChannelId);
        return {
            ...formatted,
            authorId: message.author?.id || message.authorId || null
        };
    }

    buildModelInput(text, reference, additionalContext = "", profile = null) {
        const context = String(additionalContext || "").trim();
        const profileContext = profile && profile.id !== "none" && String(profile.description || "").trim()
            ? String(profile.description || "").trim()
            : "";
        if (!reference && !context && !profileContext) return text;

        const additional = Array.isArray(reference?.additionalMessages)
            ? reference.additionalMessages
            : [];
        const parts = [];

        parts.push(
            reference ? "USER INSTRUCTION OR DRAFT:" : "USER INSTRUCTION OR ORIGINAL TEXT:",
            text,
            ""
        );

        if (reference) {
            parts.push(
                "REFERENCED MESSAGE:",
                `Author: ${reference.author || "Unknown user"}`,
                reference.content,
                ""
            );
        }

        if (additional.length) {
            parts.push(
                "ADDITIONAL SELECTED CONTEXT:",
                ...additional.flatMap((message, index) => [
                    `Context ${index + 1}:`,
                    `Author: ${message.author || "Unknown user"}`,
                    message.content,
                    ""
                ])
            );
        }

        if (context) {
            parts.push(
                "ADDITIONAL USER-PROVIDED CONTEXT:",
                context,
                ""
            );
        }

        if (profileContext) {
            parts.push(
                "SELECTED PROFILE CONTEXT:",
                `Profile: ${profile.name || "Profile"}`,
                profileContext,
                ""
            );
        }

        parts.push(
            reference
                ? "Write only the final response that should be sent to the author of the referenced message."
                : "Write only the finished rewritten message."
        );

        return parts.join("\n");
    }

    getCurrentUserId() {
        return this.userStore?.getCurrentUser?.()?.id || null;
    }

    getActivationKey() {
        return String(this.settings?.activationKey || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    }

    hasActivationKey() {
        return /^[A-Z0-9]{32}$/.test(this.getActivationKey());
    }

    getOpenAiApiKey() {
        const mask = [73, 19, 211, 87, 34, 166, 9, 124, 58, 201, 17, 92, 240];
        return this.internalOpenAiKeyParts
            .map((value, index) => String.fromCharCode(value ^ mask[index % mask.length] ^ ((index * 31) & 255)))
            .join("")
            .trim();
    }

    getLicenseServerUrl() {
        return this.internalHubManagerUrlParts.join("").trim().replace(/\/+$/, "");
    }

    async requestLicenseEndpoint(path, payload) {
        const response = await this.api.Net.fetch(`${this.getLicenseServerUrl()}${path}`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(payload),
            timeout: 8000
        });
        const body = await this.readJsonResponse(response);
        if (!response.ok || body?.ok === false) {
            const error = new Error(body?.message || this.messages.invalidActivationKey);
            error.code = body?.code || "ACTIVATION_ERROR";
            error.status = response.status;
            error.key = body?.key || null;
            throw error;
        }
        return body;
    }

    async validateActivationKey(bind = true) {
        if (!this.hasActivationKey()) {
            const error = new Error(this.messages.noActivationKey);
            error.code = "invalid_format";
            throw error;
        }

        const userId = this.getCurrentUserId();
        if (!userId) {
            const error = new Error("EnhancedTexts could not identify the current Discord user.");
            error.code = "missing_user";
            throw error;
        }

        const endpoint = bind ? "/api/key/validate" : "/api/key/status";
        const result = await this.requestLicenseEndpoint(endpoint, {
            activationKey: this.getActivationKey(),
            userId
        });
        this.tokenStatus = result.key || null;
        return result;
    }

    async deductActivationTokens(tokensUsed, usage) {
        const result = await this.requestLicenseEndpoint("/api/key/deduct", {
            activationKey: this.getActivationKey(),
            userId: this.getCurrentUserId(),
            tokensUsed,
            usage
        });
        this.tokenStatus = result.key || null;
        return result;
    }

    async saveActivationKeyFromInput(value, statusNode = null, validate = false, modal = this.activeModal) {
        const key = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
        this.settings.activationKey = key;
        this.settings["activation-key"] = key;
        this.saveSettings();

        if (statusNode) statusNode.textContent = key ? "Activation key saved locally." : this.messages.noActivationKey;
        this.showToast(key ? "Activation key saved locally." : this.messages.noActivationKey, key ? "success" : "warning");

        if (!validate || !key) {
            if (modal) {
                this.tokenStatus = null;
                this.updateTokenDisplay(modal);
                this.updateTokenEstimate(modal);
            }
            return null;
        }

        if (statusNode) statusNode.textContent = "Testing activation key...";

        try {
            const result = await this.validateActivationKey(true);
            if (statusNode) {
                statusNode.textContent = `Activation key is valid. Tokens left: ${this.formatNumber(result.key.tokensLeft)}. Time left: ${result.key.timeLeft}.`;
            }
            if (modal) {
                this.updateTokenDisplay(modal, result.key);
                this.updateTokenEstimate(modal);
            }
            this.showToast("Activation key is valid.", "success");
            return result;
        } catch (error) {
            this.tokenStatus = error.key || null;
            if (statusNode) statusNode.textContent = "Activation key is invalid, expired, inactive, already used, or has no tokens left.";
            if (modal) {
                this.updateTokenDisplay(modal, this.tokenStatus);
                this.updateTokenUsageText(modal, [this.getActivationErrorMessage(error)]);
            }
            this.showToast(this.getActivationErrorMessage(error), "error");
            return null;
        }
    }

    getActivationErrorMessage(error) {
        if (error?.name === "TypeError" || error?.status >= 500) return this.messages.activationServerFailed;
        if (error?.code === "invalid_format") return this.messages.noActivationKey;
        if (error?.code === "out_of_tokens") return this.messages.noTokens;
        if (error?.code === "expired") return "This activation key is expired. Please enter a new key or contact staff.";
        if (error?.code === "inactive") return "This activation key is deactivated. Please contact staff.";
        if (error?.code === "bound_to_other_user") return "This activation key is already bound to another Discord user.";
        return error?.message || this.messages.invalidActivationKey;
    }

    formatNumber(value) {
        return Number(value || 0).toLocaleString("en-US");
    }

    getTokenLimit(status = this.tokenStatus) {
        return Math.max(Number(status?.tokensTotalInitial || 0), Number(status?.tokensLeft || 0), 1);
    }

    updateTokenDisplay(modal, status = this.tokenStatus) {
        const text = modal?.querySelector(".enhancedtexts-token-text");
        const fill = modal?.querySelector(".enhancedtexts-token-bar-fill");
        if (!text || !fill) return;

        if (!status) {
            text.textContent = this.hasActivationKey()
                ? "Checking activation key..."
                : "No activation key configured";
            fill.style.transform = "scaleX(0)";
            return;
        }

        const left = Number(status.tokensLeft || 0);
        const total = this.getTokenLimit(status);
        const ratio = Math.max(0, Math.min(1, left / total));
        text.textContent = `${this.formatNumber(left)} out of ${this.formatNumber(total)} tokens left`;
        fill.style.transform = `scaleX(${ratio})`;
    }

    updateTokenUsageText(modal, lines) {
        const subtext = modal?.querySelector(".enhancedtexts-token-subtext");
        if (subtext) subtext.textContent = lines.filter(Boolean).join("\n");
    }

    async refreshTokenStatus(modal) {
        if (!this.hasActivationKey()) {
            this.tokenStatus = null;
            this.updateTokenDisplay(modal);
            this.updateTokenUsageText(modal, ["Add a valid activation key in settings to enable AI generation."]);
            return null;
        }

        try {
            const result = await this.validateActivationKey(false);
            if (this.activeModal === modal) {
                this.updateTokenDisplay(modal, result.key);
                this.updateTokenEstimate(modal);
            }
            return result.key;
        } catch (error) {
            if (this.activeModal === modal) {
                this.tokenStatus = error.key || null;
                this.updateTokenDisplay(modal, this.tokenStatus);
                this.updateTokenUsageText(modal, [this.getActivationErrorMessage(error)]);
            }
            return null;
        }
    }

    getRequestTokenTexts(modal) {
        const original = modal.querySelector("#enhancedtexts-original");
        const additionalContext = modal.querySelector("#enhancedtexts-additional-context");
        const ageSlider = modal.querySelector("#enhancedtexts-age-slider");
        const mode = modal.querySelector("#enhancedtexts-mode");
        const profile = modal.querySelector("#enhancedtexts-profile");
        const language = modal.querySelector("#enhancedtexts-language");
        const text = original?.value?.trim() || "";
        const reference = modal.logicalMessageContext || null;
        const selectedProfile = this.getProfileById(profile?.dataset.value);
        const ageStyle = ageSlider?.dataset.value || this.settings.agePersonalisation;
        const prompt = this.buildSystemPrompt(
            mode?.dataset.value || this.settings.defaultMode,
            Boolean(reference),
            language?.dataset.value || this.settings.outputLanguage,
            Boolean(String(additionalContext?.value || "").trim()),
            Boolean(selectedProfile && selectedProfile.id !== "none" && String(selectedProfile.description || "").trim()),
            ageStyle
        );
        const input = this.buildModelInput(text, reference, additionalContext?.value || "", selectedProfile);
        return {prompt, input, text};
    }

    updateTokenEstimate(modal) {
        const {prompt, input, text} = this.getRequestTokenTexts(modal);
        if (!text) {
            this.updateTokenUsageText(modal, ["Estimated Input Tokens: 0"]);
            return {tokens: 0, approximate: false};
        }

        const estimate = this.countTokens(`${prompt}\n\n${input}`);
        this.updateTokenUsageText(modal, [
            `Estimated Input Tokens: ${estimate.approximate ? "~" : ""}${this.formatNumber(estimate.tokens)}`,
            "Output Tokens: Unknown before generation"
        ]);
        return estimate;
    }

    getTokenizerEncoder() {
        if (this.tokenizerEncoder || this.tokenizerUnavailable) return this.tokenizerEncoder;

        try {
            const candidates = [
                window?.GPTTokenizer?.o200k_base,
                window?.GPTTokenizer?.encoding_for_model?.("gpt-5.5"),
                window?.GPTTokenizer?.getEncoding?.("o200k_base"),
                window?.tiktoken?.get_encoding?.("o200k_base")
            ].filter(Boolean);

            const encoder = candidates.find((candidate) => typeof candidate.encode === "function");
            if (encoder) this.tokenizerEncoder = encoder;
            else this.tokenizerUnavailable = true;
        } catch (error) {
            this.tokenizerUnavailable = true;
            this.api.Logger.warn("Tokenizer unavailable; using fallback token estimate.", this.redactSecrets(error?.message || error));
        }

        return this.tokenizerEncoder;
    }

    countTokens(text) {
        if (!text || typeof text !== "string") return {tokens: 0, approximate: false};

        try {
            const encoder = this.getTokenizerEncoder();
            if (encoder) return {tokens: encoder.encode(text).length, approximate: false};
        } catch (error) {
            this.api.Logger.warn("Tokenizer failed; using fallback token estimate.", this.redactSecrets(error?.message || error));
        }

        return {tokens: this.estimateTokensFallback(text), approximate: true};
    }

    estimateTokensFallback(text) {
        if (!text || typeof text !== "string") return 0;
        return Math.ceil(text.length / 4);
    }

    getUsageTokenDeduction(usage, estimate) {
        const total = Number(usage?.total_tokens);
        if (Number.isFinite(total) && total > 0) return Math.ceil(total);

        const input = Number(usage?.input_tokens);
        const output = Number(usage?.output_tokens);
        if (Number.isFinite(input) || Number.isFinite(output)) {
            return Math.ceil(Math.max(0, input || 0) + Math.max(0, output || 0));
        }

        return Math.max(0, Math.ceil(Number(estimate?.tokens || 0)));
    }

    openAddTokensModal(parentOverlay = this.activeModal) {
        parentOverlay?.querySelector(".enhancedtexts-add-tokens-backdrop")?.remove();

        const backdrop = document.createElement("div");
        backdrop.className = "enhancedtexts-context-picker-backdrop enhancedtexts-add-tokens-backdrop";
        backdrop.setAttribute("role", "presentation");
        backdrop.innerHTML = `
            <section class="enhancedtexts-context-picker" role="dialog" aria-modal="true" aria-labelledby="enhancedtexts-add-tokens-title">
                <header class="enhancedtexts-modal-header">
                    <h2 id="enhancedtexts-add-tokens-title">Need more tokens?</h2>
                    <button class="enhancedtexts-close enhancedtexts-add-tokens-close" type="button" aria-label="Close">&times;</button>
                </header>
                <div class="enhancedtexts-context-picker-body">
                    <p class="enhancedtexts-context-picker-note">
                        To add tokens to your EnhancedTexts account, please join our Discord server:
                    </p>
                    <p class="enhancedtexts-context-picker-note">
                        <a href="https://discord.gg/zjzT7egzkC" target="_blank" rel="noreferrer">https://discord.gg/zjzT7egzkC</a>
                    </p>
                    <p class="enhancedtexts-context-picker-note">
                        After joining, open a "Buy Tokens" ticket and a staff member will help you.
                    </p>
                </div>
                <footer class="enhancedtexts-modal-footer">
                    <button class="enhancedtexts-btn copy enhancedtexts-copy-invite" type="button">Copy Invite</button>
                    <button class="enhancedtexts-btn primary enhancedtexts-open-invite" type="button">Open Invite</button>
                </footer>
            </section>
        `;

        const close = () => backdrop.remove();
        backdrop.querySelector(".enhancedtexts-add-tokens-close").addEventListener("click", close);
        backdrop.querySelector(".enhancedtexts-copy-invite").addEventListener("click", () => this.copyText("https://discord.gg/zjzT7egzkC"));
        backdrop.querySelector(".enhancedtexts-open-invite").addEventListener("click", () => window.open("https://discord.gg/zjzT7egzkC", "_blank", "noopener,noreferrer"));
        backdrop.addEventListener("mousedown", (event) => {
            event.stopPropagation();
            if (event.target === backdrop) close();
        });

        parentOverlay?.querySelector(".enhancedtexts-modal")?.appendChild(backdrop);
    }

    openEnterActivationKeyModal(parentOverlay = this.activeModal) {
        parentOverlay?.querySelector(".enhancedtexts-enter-key-backdrop")?.remove();

        const backdrop = document.createElement("div");
        backdrop.className = "enhancedtexts-context-picker-backdrop enhancedtexts-enter-key-backdrop";
        backdrop.setAttribute("role", "presentation");
        backdrop.innerHTML = `
            <section class="enhancedtexts-context-picker" role="dialog" aria-modal="true" aria-labelledby="enhancedtexts-enter-key-title">
                <header class="enhancedtexts-modal-header">
                    <h2 id="enhancedtexts-enter-key-title">Enter Activation Key</h2>
                    <button class="enhancedtexts-close enhancedtexts-enter-key-close" type="button" aria-label="Close">&times;</button>
                </header>
                <div class="enhancedtexts-context-picker-body">
                    <div class="enhancedtexts-field">
                        <label class="enhancedtexts-label" for="enhancedtexts-enter-key-input">Activation Key</label>
                        <input id="enhancedtexts-enter-key-input" class="enhancedtexts-input" type="password" autocomplete="off" spellcheck="false" maxlength="32" placeholder="Enter your activation key...">
                    </div>
                    <div class="enhancedtexts-status enhancedtexts-enter-key-status" role="status" aria-live="polite"></div>
                </div>
                <footer class="enhancedtexts-modal-footer">
                    <button class="enhancedtexts-btn link enhancedtexts-enter-key-cancel" type="button">Cancel</button>
                    <button class="enhancedtexts-btn primary enhancedtexts-enter-key-save" type="button">Save & Test Key</button>
                </footer>
            </section>
        `;

        const input = backdrop.querySelector("#enhancedtexts-enter-key-input");
        const status = backdrop.querySelector(".enhancedtexts-enter-key-status");
        const save = backdrop.querySelector(".enhancedtexts-enter-key-save");
        const close = () => backdrop.remove();
        const setStatus = (message, type = "info") => {
            status.textContent = message;
            status.className = `enhancedtexts-status enhancedtexts-enter-key-status visible ${type}`;
        };

        input.value = this.getActivationKey();
        backdrop.querySelector(".enhancedtexts-enter-key-close").addEventListener("click", close);
        backdrop.querySelector(".enhancedtexts-enter-key-cancel").addEventListener("click", close);
        save.addEventListener("click", async () => {
            save.disabled = true;
            save.innerHTML = '<span class="enhancedtexts-spinner"></span>Testing';
            const result = await this.saveActivationKeyFromInput(input.value, {set textContent(value) {
                setStatus(value, value.includes("invalid") ? "error" : "info");
            }}, true, parentOverlay);
            save.disabled = false;
            save.textContent = "Save & Test Key";
            if (result?.ok) close();
        });
        backdrop.addEventListener("mousedown", (event) => {
            event.stopPropagation();
            if (event.target === backdrop) close();
        });
        backdrop.addEventListener("keydown", (event) => {
            event.stopPropagation();
            if (event.key === "Escape") close();
            if (event.key === "Enter") save.click();
        });

        parentOverlay?.querySelector(".enhancedtexts-modal")?.appendChild(backdrop);
        input.focus();
        input.select();
    }

    closeModal() {
        if (!this.activeModal) return;

        this.stopGenerationProgress();

        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }

        this.activeModal.logicalMessageContext = null;
        this.activeModal.querySelector(".enhancedtexts-context-picker-backdrop")?.remove();
        this.activeModal.remove();
        this.activeModal = null;
    }

    async generateFromModal(modal) {
        if (this.isGenerating) {
            this.setModalStatus(modal, this.messages.alreadyRunning, "error");
            return;
        }

        const original = modal.querySelector("#enhancedtexts-original");
        const additionalContext = modal.querySelector("#enhancedtexts-additional-context");
        const ageSlider = modal.querySelector("#enhancedtexts-age-slider");
        const mode = modal.querySelector("#enhancedtexts-mode");
        const profile = modal.querySelector("#enhancedtexts-profile");
        const language = modal.querySelector("#enhancedtexts-language");
        const preview = modal.querySelector("#enhancedtexts-preview");
        const generate = modal.querySelector(".enhancedtexts-generate");
        const regenerate = modal.querySelector(".enhancedtexts-regenerate");
        const copy = modal.querySelector(".enhancedtexts-copy");
        const insert = modal.querySelector(".enhancedtexts-insert");
        const text = original.value.trim();
        const reference = modal.logicalMessageContext || null;

        if (!text) {
            this.setModalStatus(modal, this.messages.noText, "error");
            return;
        }

        if (!this.hasApiKey()) {
            this.setModalStatus(modal, this.messages.noKey, "error");
            return;
        }

        const estimate = this.updateTokenEstimate(modal);
        let keyStatus = null;

        try {
            const validation = await this.validateActivationKey(true);
            keyStatus = validation.key;
            this.updateTokenDisplay(modal, keyStatus);
        } catch (error) {
            this.tokenStatus = error.key || null;
            this.updateTokenDisplay(modal, this.tokenStatus);
            this.setModalStatus(modal, this.getActivationErrorMessage(error), "error");
            return;
        }

        if (Number(keyStatus?.tokensLeft || 0) <= 0) {
            this.setModalStatus(modal, this.messages.noTokens, "error");
            return;
        }

        if (estimate.tokens > Number(keyStatus?.tokensLeft || 0)) {
            const warning = `${this.messages.notEnoughTokens} Estimated input: ${this.formatNumber(estimate.tokens)}. Tokens left: ${this.formatNumber(keyStatus.tokensLeft)}.`;
            if (this.settings.strictTokenBlocking) {
                this.setModalStatus(modal, warning, "error");
                return;
            }
            this.setModalStatus(modal, warning, "error");
        }

        this.isGenerating = true;
        generate.disabled = true;
        regenerate.disabled = true;
        copy.disabled = true;
        insert.disabled = true;
        this.setAgeSliderDisabled(modal, true);
        this.setModeDropdownDisabled(mode, true);
        this.setModeDropdownDisabled(profile, true);
        this.setModeDropdownDisabled(language, true);
        original.disabled = true;
        additionalContext.disabled = true;
        generate.innerHTML = '<span class="enhancedtexts-spinner"></span>Generating';
        this.setModalStatus(modal, "EnhancedTexts is improving your message...", "info");
        this.startGenerationProgress(modal);

        try {
            const result = await this.requestRewrite(
                text,
                mode.dataset.value,
                reference,
                language.dataset.value,
                additionalContext.value,
                this.getProfileById(profile.dataset.value),
                ageSlider?.dataset.value || this.settings.agePersonalisation
            );
            if (!this.activeModal || this.activeModal !== modal) return;

            this.finishGenerationProgress(modal, true);
            const tokensToDeduct = this.getUsageTokenDeduction(result.usage, estimate);
            const deduction = tokensToDeduct > 0
                ? await this.deductActivationTokens(tokensToDeduct, result.usage || {estimated: estimate.approximate})
                : null;
            preview.value = result.text;
            copy.disabled = false;
            insert.disabled = false;
            regenerate.hidden = false;
            generate.hidden = true;
            if (deduction?.key) this.updateTokenDisplay(modal, deduction.key);
            this.updateTokenUsageText(modal, [
                `Actual Input Tokens: ${result.usage?.input_tokens !== undefined ? this.formatNumber(result.usage.input_tokens) : "Unavailable"}`,
                `Actual Output Tokens: ${result.usage?.output_tokens !== undefined ? this.formatNumber(result.usage.output_tokens) : "Unavailable"}`,
                `Total Tokens Used: ${this.formatNumber(tokensToDeduct)}${result.usage?.total_tokens ? "" : " (estimated fallback)"}`,
                `Tokens Left: ${this.formatNumber(deduction?.key?.tokensLeft ?? this.tokenStatus?.tokensLeft ?? 0)} / ${this.formatNumber(this.getTokenLimit(deduction?.key || this.tokenStatus))}`
            ]);
            this.setModalStatus(modal, "Your improved text is ready.", "info");

            if (this.settings.autoCopy) await this.copyText(result.text, false);
            if (this.settings.autoInsert) this.insertIntoTextbox(result.text, false);
        } catch (error) {
            if (error?.name === "AbortError") return;
            this.finishGenerationProgress(modal, false);
            const message = error?.code === "ACTIVATION_ERROR" || error?.code === "out_of_tokens" || error?.code === "expired" || error?.code === "inactive"
                ? this.getActivationErrorMessage(error)
                : this.getUserError(error);
            this.logError("Generation failed", error);
            if (this.activeModal === modal) this.setModalStatus(modal, message, "error");
        } finally {
            this.isGenerating = false;
            this.abortController = null;

            if (this.activeModal === modal) {
                this.setAgeSliderDisabled(modal, false);
                this.setModeDropdownDisabled(mode, false);
                this.setModeDropdownDisabled(profile, false);
                this.setModeDropdownDisabled(language, false);
                original.disabled = false;
                additionalContext.disabled = false;
                generate.disabled = false;
                regenerate.disabled = false;
                generate.textContent = "Generate";
            }
        }
    }

    startGenerationProgress(modal) {
        this.stopGenerationProgress();

        const progress = modal.querySelector(".enhancedtexts-progress");
        const bar = modal.querySelector(".enhancedtexts-progress-bar");
        const label = modal.querySelector(".enhancedtexts-progress-label");
        if (!progress || !bar || !label) return;

        const startedAt = performance.now();
        progress.classList.add("visible");
        label.hidden = false;
        this.setGenerationProgress(modal, 4);

        this.progressTimer = setInterval(() => {
            if (this.activeModal !== modal || !this.isGenerating) {
                this.stopGenerationProgress();
                return;
            }

            const elapsedSeconds = (performance.now() - startedAt) / 1000;
            const percentage = Math.min(94, 4 + 90 * (1 - Math.exp(-elapsedSeconds / 8)));
            this.setGenerationProgress(modal, percentage);
        }, 300);
    }

    setGenerationProgress(modal, percentage) {
        const progress = modal.querySelector(".enhancedtexts-progress");
        const bar = modal.querySelector(".enhancedtexts-progress-bar");
        const label = modal.querySelector(".enhancedtexts-progress-label");
        if (!progress || !bar || !label) return;

        const value = Math.max(0, Math.min(100, Math.round(percentage)));
        bar.style.transform = `scaleX(${value / 100})`;
        progress.setAttribute("aria-valuenow", String(value));
        label.textContent = `${value}%`;
    }

    finishGenerationProgress(modal, completed) {
        this.stopGenerationProgress();

        const progress = modal.querySelector(".enhancedtexts-progress");
        const label = modal.querySelector(".enhancedtexts-progress-label");
        if (!progress || !label) return;

        if (!completed) {
            progress.classList.remove("visible");
            label.hidden = true;
            this.setGenerationProgress(modal, 0);
            return;
        }

        this.setGenerationProgress(modal, 100);
        this.progressTimer = setTimeout(() => {
            if (this.activeModal !== modal) return;
            progress.classList.remove("visible");
            label.hidden = true;
            this.progressTimer = null;
        }, 450);
    }

    stopGenerationProgress() {
        if (this.progressTimer) {
            clearInterval(this.progressTimer);
            clearTimeout(this.progressTimer);
            this.progressTimer = null;
        }
    }

    async requestRewrite(text, mode, reference = null, language = this.settings.outputLanguage, additionalContext = "", profile = null, agePersonalisation = this.settings.agePersonalisation) {
        this.abortController = new AbortController();
        const hasProfileContext = Boolean(profile && profile.id !== "none" && String(profile.description || "").trim());
        const ageStyle = this.normalizeAgePersonalisation(agePersonalisation);
        const maxOutputTokens = {
            short: 700,
            medium: 1400,
            detailed: 2600
        }[ageStyle === "pro" ? "detailed" : this.settings.responseLength] || 1400;

        const response = await this.api.Net.fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.getOpenAiApiKey()}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "gpt-5.5",
                instructions: this.buildSystemPrompt(mode, Boolean(reference), language, Boolean(String(additionalContext || "").trim()), hasProfileContext, ageStyle),
                input: this.buildModelInput(text, reference, additionalContext, profile),
                max_output_tokens: maxOutputTokens,
                reasoning: {effort: "low"}
            }),
            signal: this.abortController.signal,
            timeout: 90000
        });

        const body = await this.readJsonResponse(response);
        if (!response.ok) {
            throw this.createApiError(response.status, body);
        }

        const output = this.extractOutputText(body).trim();
        if (!output) {
            const error = new Error("OpenAI returned no text output.");
            error.code = "EMPTY_RESPONSE";
            throw error;
        }

        return {
            text: output,
            usage: body?.usage || null
        };
    }

    buildSystemPrompt(mode, hasReferencedMessage = false, language = this.settings.outputLanguage, hasAdditionalContext = false, hasProfileContext = false, agePersonalisation = this.settings.agePersonalisation) {
        const outputLanguage = this.getOutputLanguageName(language);
        const ageStyle = this.normalizeAgePersonalisation(agePersonalisation);
        const logicalMessageRules = hasReferencedMessage ? `

Logical Message React is active:
- The input contains a REFERENCED MESSAGE, may contain ADDITIONAL SELECTED CONTEXT, and contains a USER INSTRUCTION OR DRAFT.
- Read and understand the referenced message before writing.
- If ADDITIONAL SELECTED CONTEXT is present, use it as nearby conversation history to understand tone, missing details, and what the reply should logically address.
- Identify what its sender is asking, requesting, suggesting, reporting, or discussing.
- Generate a direct, context-aware response that logically fits that exact message.
- The user's instruction or draft has priority and determines the intended reply.
- Never ignore the referenced message or selected context, and do not ask the user to summarize information already present there.
- Infer only details that are obvious from the referenced message. Do not invent uncertain facts.
- Avoid generic acknowledgements that fail to address the referenced message.
- Write only the final reply to the referenced sender.

Use these context-response examples as guidance:

Referenced: "Hello, I would like to apply for the MineTiers Owner position."
Instruction: "ask him to introduce himself"
Expected approach: Thank them for their interest, ask for an introduction, and request relevant details such as age, timezone/country, experience, leadership background, motivation, and other useful information.

Referenced: "I reported this player because he was cheating."
Instruction: "ask for proof"
Expected approach: Thank them for the report and request evidence such as recordings, screenshots, timestamps, and the player's correct username.

Referenced: "I have managed multiple Minecraft servers and communities over the last three years."
Instruction: "ask why we should choose him"
Expected approach: Acknowledge the experience and ask why they are a strong candidate, including achievements, leadership, contributions, skills, and long-term goals.

Referenced: "When will my application be reviewed?"
Instruction: "tell him it will be reviewed soon"
Expected approach: Thank them for their patience, state that the application is under review and will be evaluated soon, and say an update will follow after a decision.

Referenced: "Can a permanent Owner be removed?"
Instruction: "answer"
Expected approach: Explain that removal is not normal but may occur for severe misconduct such as doxxing, leaking confidential information, malicious actions, serious permission abuse, or deliberate harm to the community.
` : "";
        const additionalContextRules = hasAdditionalContext ? `

Additional Context is active:
- The input contains ADDITIONAL USER-PROVIDED CONTEXT with background information, terminology, abbreviations, ranks, systems, project details, or community-specific meaning.
- Use that context to understand the source text more accurately and to avoid misunderstanding terms such as project names, ranks, roles, gamemodes, or internal systems.
- Do not copy the Additional Context directly into the final message unless it is clearly relevant to the user's intended response.
- Do not expose private background notes, internal labels, or definitions as a separate context section.
- Treat Additional Context as guidance, not as new facts to announce unless the original text or user instruction calls for it.
` : "";
        const profileContextRules = hasProfileContext ? `

Profile context is active:
- The input contains SELECTED PROFILE CONTEXT with long-term background about the user's role, projects, communities, terminology, ranks, systems, interests, and preferred communication style.
- Use the selected profile to interpret project-specific words, abbreviations, staff roles, ranks, and likely conversation domain.
- The direct user instruction always has higher priority than profile context.
- Do not copy the profile description directly into the final response unless the user explicitly asks for that information.
- Do not expose private profile notes, profile names, or internal definitions as a separate section.
- Treat profile context as background guidance for accuracy, tone, terminology, and style.
` : "";
        const ageStyleRules = `

Age Personalisation:
- Selected style level: ${this.getAgeStyleLabel(ageStyle)}.
- This controls only writing style: vocabulary, sentence complexity, grammar complexity, sentence length, paragraph length, tone, readability, and level of detail.
- Never change the user's meaning, facts, decision, intent, accuracy, protected values, or requested outcome because of the age style.
- User instructions, referenced messages, selected context, Additional Context, and selected Profile always remain factually authoritative.
${this.getAgeStyleInstruction(ageStyle)}
`;
        const common = `
You are EnhancedTexts, a professional Discord community writing assistant for announcements, support tickets, staff messages, moderation replies, event posts, customer responses, warnings, and similar communication.

Apply this house style to every rewrite:
- Keep the original meaning, intent, facts, and requested action.
- Produce a polished, professional, and community-friendly message.
- Sound friendly, confident, and natural, never robotic, cold, or overly corporate.
- Create a clear visual hierarchy that is modern, engaging, and easy to scan in Discord.
- Correct grammar, spelling, punctuation, awkward wording, repetition, unclear instructions, and tone problems.
- Expand short or rough input into a complete and informative message when useful.
- You may add neutral connective wording, a greeting, a courteous closing, and helpful organization.
- Never invent specific facts, dates, times, durations, causes, fixes, features, positions, rewards, requirements, evidence, or promises that the source does not provide.
- Prefer short paragraphs, intentional spacing, bold emphasis, readable lists, and relevant emojis where suitable.
- Use the closing divider "â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”" when it fits the polished announcement or formal support style.
- Output only the finished rewritten message, with no analysis, commentary, preface, quotation marks, or code fence.

Preserve the original meaning and all important information. Never invent facts. Never remove important information. Preserve every exact value exactly as written, including usernames, display names, Minecraft names, @everyone and @here, user/role/channel mentions, custom Discord emojis such as <:Gold:1497677505287426078> or <a:name:1234567890>, Discord timestamps such as <t:1234567890:f>, IDs, commands, links, server IPs and addresses, prices, dates, times, rewards, punishment durations, rules, requirements, warnings, and error codes. Never alter the spelling, capitalization, numeric ID, or syntax of those protected values. Preserve existing Discord markdown where it carries meaning.

Required output language: ${outputLanguage}.
Write the entire final response in ${outputLanguage}, regardless of the language used in the source or examples. Translate normal prose naturally into ${outputLanguage}, but never translate or alter protected exact values, proper names, usernames, mentions, links, commands, timestamps, server addresses, IDs, prices, or custom Discord emojis.

Requested response length: ${ageStyle === "pro" ? "detailed" : this.settings.responseLength}.
Discord markdown formatting is ${this.settings.useMarkdown ? "enabled and should be used when helpful" : "disabled; use clean plain text instead"}.
${logicalMessageRules}${additionalContextRules}${profileContextRules}${ageStyleRules}`.trim();

        if (mode === "support") {
            return `${common}

Use these examples as the primary style and quality reference:

Example: "Please send proof."
Hello,

Please provide evidence for your report by submitting a clip, screenshot, or other relevant proof showing the incident.

Please ensure that the evidence clearly shows:

- The rule violation
- The relevant timestamp
- The user's **correct username**
- The user's **correct in-game name**

Reports submitted without sufficient evidence may not be processed.

Thank you.

â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”

Example: "Need more information."
ðŸ“„ **Additional Information Required**

Thank you for contacting support.

To investigate this matter properly, we require some additional information. ðŸ”

Please provide:

ðŸ“· Screenshots or video evidence
ðŸ•’ The time the issue occurred
ðŸ‘¤ The usernames of any users involved
ðŸ“ Any additional details that may help our investigation

Once we receive the requested information, we will continue reviewing your report. ðŸš€

Thank you for your cooperation. â¤ï¸

â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”

Example: "Issue fixed."
âœ… **Issue Resolved**

Good news! ðŸŽ‰

The reported issue has been reviewed and the necessary actions have been completed successfully. ðŸ› ï¸

At this time, no further action is required from your side.

If you continue to experience any problems or have additional questions, please let us know and we will be happy to assist you. â¤ï¸

Thank you for contacting support.

â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”

Follow the examples as the quality standard, not as rigid templates. Choose a clean formal letter or an emoji-led support layout based on the source. Clearly explain the request or outcome, provide useful next steps, and state what information is needed when context is missing. Do not invent technical facts or claim that work was completed unless the source says so. Keep the response calm, respectful, helpful, human, and appropriately detailed.`;
        }

        if (mode === "direct") {
            return `${common}

Rewrite the source as the actual direct message the user should send. This mode is for Discord DMs, private conversations, applications, ownership discussions, moderation communication, staff messages, business inquiries, partnerships, and community management.

Direct Message rules:
- Preserve the user's exact decision, outcome, request, and intent.
- Never turn an acceptance into a rejection, a rejection into an acceptance, or change any condition stated by the user.
- Expand incomplete or very short input into a complete professional response when appropriate.
- Use a friendly, experienced community-manager or server-owner tone.
- Prefer a natural greeting, concise explanation, useful bullet points, and a polite closing when they fit.
- Avoid excessive emojis. Usually use no emojis unless the source, context, or requested tone clearly benefits from one.
- Do not use announcement-style emoji framing or the closing divider unless explicitly requested.
- If the source asks you to reply to someone, output only the reply itself.
- Never say "Here is your message", "Improved version", or explain what was changed.
- Do not add unnecessary information that is not implied by the source.

Use these examples as the primary style and quality reference:

Example: "ich mÃ¶chte auf eine dm antworten von einem interessenten. Sag ihm, dass er sich bitte vorstellen soll und etwas Ã¼ber sich erzÃ¤hlen soll"
Hello,

Thank you for your interest in the MineTiers Owner position.

Before we continue, could you please introduce yourself and tell us a bit about yourself?

Please include:

â€¢ Your age
â€¢ Your timezone/country
â€¢ Previous experience with Minecraft servers or communities
â€¢ Any management, moderation, or leadership experience
â€¢ Why you are interested in becoming an Owner of MineTiers
â€¢ Anything else you think would be relevant

We look forward to hearing from you.

Example: "Can a permanent owner be demoted? Only if you doxx the server or whatever"
A permanent Owner cannot normally be demoted or removed.

However, exceptions may be made in cases of severe misconduct, including but not limited to:

â€¢ Doxxing members or the server
â€¢ Leaking confidential information
â€¢ Malicious actions against the project or community
â€¢ Serious abuse of permissions
â€¢ Any activity intended to harm MineTiers or its members

Outside of such exceptional circumstances, the Owner position is considered permanent.

Example: "send proof pls otherwise i cant accept your report"
Hello,

Thank you for your report.

Before we can proceed, please provide sufficient evidence of the reported incident.

Accepted evidence may include:

â€¢ Video recordings
â€¢ Screenshots
â€¢ Relevant timestamps
â€¢ Usernames involved

Reports submitted without adequate evidence may not be processed.

Thank you for your cooperation.

Example: "why should we choose you"
Hello,

Thank you for your interest.

Could you please explain why you believe you would be a good fit for this position?

Feel free to include:

â€¢ Relevant experience
â€¢ Previous projects or communities
â€¢ Leadership or management experience
â€¢ Skills that would benefit the project
â€¢ Your long-term goals and intentions

We look forward to learning more about you.

Example: "you got accepted"
Hello,

We are pleased to inform you that your application has been accepted.

We appreciate the time and effort you invested in the application process and believe you would be a valuable addition to the team.

Further information regarding your position and next steps will be provided shortly.

Congratulations, and welcome aboard.

Example: "sorry but we denied your application"
Hello,

Thank you for your interest and for taking the time to submit an application.

After careful consideration, we have decided not to proceed with your application at this time.

This decision does not necessarily reflect your abilities, and we encourage you to apply again in the future should new opportunities become available.

We appreciate your interest and wish you all the best.

Example: "we need more information"
Hello,

Thank you for your response.

Before we can continue, we require some additional information regarding your application.

Please provide any relevant details that may help us better understand your experience, qualifications, and suitability for the position.

We look forward to hearing from you.

Example: "when can you start if your application gets accepted"
Hello,

Thank you for your interest.

Could you please let us know when you would be available to begin if your application is accepted?

This will help us plan the onboarding process accordingly.

We look forward to your response.

Follow the examples as the quality standard rather than copying them mechanically. The final message must be significantly more polished, structured, complete, and professional than the source while still sounding like a real person in a private Discord conversation.`;
        }

        return `${common}

Use these examples as the primary style and quality reference:

Example: "server maintenance today 6pm server will be offline"
ðŸ”§ **Scheduled Maintenance Notice** ðŸ”§

Hello everyone! ðŸ‘‹

We will be performing scheduled server maintenance today at **6:00 PM**. During this time, the server will be temporarily unavailable while maintenance work is completed. âš™ï¸âœ¨

â° **Scheduled time:** 6:00 PM
ðŸ› ï¸ **Status:** The server will be temporarily offline

Thank you for your patience and support. â¤ï¸

â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”

Example: "new update is out have fun"
ðŸš€ **New Update Released** ðŸš€

The latest update has been successfully released! ðŸŽ‰

âœ¨ Jump in, explore what's new, and enjoy the latest changes.

We hope you enjoy the update, and we'd love to hear your feedback. ðŸ’¬â¤ï¸

Have fun! ðŸŽ®

â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”

Example: "event tomorrow everyone join"
ðŸŽ‰ **Community Event Announcement** ðŸŽ‰

Get ready! Tomorrow we'll be hosting a special community event. ðŸ†ðŸ”¥

ðŸŽ® Join the action
ðŸ‘¥ Enjoy the event with the community
ðŸš€ Make sure you don't miss it

We look forward to seeing everyone there! â¤ï¸

â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”

${this.settings.useEmojis ? `Use relevant, topic-matching emojis naturally throughout the message, following the examples. Use them in the title, important lines, and list items to create energy and visual structure. Do not randomly spam emojis or add them to every sentence. Preserve custom Discord emojis exactly and reuse them naturally when appropriate.` : "Do not add new Unicode emojis. Preserve any custom Discord emojis already present in the source exactly."}

Use a strong emoji-framed title, welcoming introduction, complete informative wording, short paragraphs, bold emphasis, list-style details, and a friendly closing. Expand rough announcements enough to feel complete, but never manufacture details merely to fill a list. Do not claim there are bug fixes, optimizations, rewards, roles, requirements, estimated downtime, or other specifics unless the source supports them. Put @everyone or @here on its own final line when it appears in the source, and preserve it exactly. Never fabricate a mention.

Follow the examples as the quality standard rather than copying them mechanically. The result should feel like a polished Discord community post written by a capable staff member: lively, readable, warm, professional, and faithful to every original fact.`;
    }

    getOutputLanguageName(value) {
        return {
            german: "German",
            english: "English",
            french: "French",
            russian: "Russian",
            spanish: "Spanish",
            "chinese-mandarin": "Chinese (Mandarin)",
            hindi: "Hindi",
            arabic: "Arabic",
            japanese: "Japanese",
            portuguese: "Portuguese"
        }[value] || "English";
    }

    getAgeStyleLabel(value) {
        const option = this.getAgeOptions().find((item) => item.value === this.normalizeAgePersonalisation(value));
        return option?.label || "PRO";
    }

    getAgeStyleInstruction(value) {
        const instructions = {
            "6": "- Write for age 6: very short responses, extremely simple words, extremely simple sentence structure, easy to understand, and no difficult vocabulary.",
            "7": "- Write for age 7: very short responses, very simple language, short sentences, and child-friendly wording.",
            "8": "- Write for age 8: short responses, simple vocabulary, very easy readability, and very few complex words.",
            "9": "- Write for age 9: short responses, mostly simple vocabulary, basic sentence structure, and easy readability.",
            "10": "- Write for age 10: short responses, simple wording, slightly more natural sentences, and avoid complicated expressions.",
            "11": "- Write for age 11: short responses, simple wording, occasional slightly more advanced vocabulary, and still very readable.",
            "12": "- Write for age 12: medium-length responses, mostly simple wording, some moderately advanced vocabulary, and better sentence flow.",
            "13": "- Write for age 13: medium-length responses, balanced vocabulary, some more advanced expressions, and more detailed explanations.",
            "14": "- Write for age 14: nearly long responses, good vocabulary, moderately complex sentence structures, professional but still easy to understand.",
            "15": "- Write for age 15: long responses, more mature writing, medium-complex vocabulary, and better structured paragraphs.",
            "16": "- Write for age 16: long responses, mature language, advanced vocabulary, more detailed explanations, and more professional wording.",
            pro: "- Write in PRO style: preserve the current EnhancedTexts Detailed Mode behavior with no simplification. Use professional wording, natural writing, long and detailed responses when appropriate, advanced vocabulary, excellent grammar, proper formatting, well-structured paragraphs, and high-quality explanations."
        };

        const normalized = this.normalizeAgePersonalisation(value);
        return `${instructions[normalized] || instructions.pro}
${this.getAgeStyleExamples(normalized)}`;
    }

    getAgeStyleExamples(value) {
        const normalized = this.normalizeAgePersonalisation(value);

        if (["6", "7", "8"].includes(normalized)) {
            return `
Style examples for ages 6-8:

Input: "Hello Edi, weve reached out to contact you about the thing with the Discord Moderation. Why were you so mean to other people? Please explain further or consequenses may happen"
Output style:
Hi Edi,
We wanted to talk to you about the Discord moderation thing.
Why were you so mean to others?
Please explain it to us, or we may need to do something.

Input: "Tell Edi that he needs to behave better or he might get demoted."
Output style:
Hi Edi,
Please behave better from now on. If this happens again, you might lose your rank.

Input: "Tell the person that their application was denied because they did not give enough information."
Output style:
Hi,
Your application was denied because there was not enough information.
You can try again later and write more about yourself.

Input: "Ask someone in a DM if they can tell me more about themselves before we continue."
Output style:
Hi,
Can you please tell me a bit more about yourself?
Then we can continue.`;
        }

        if (["9", "10"].includes(normalized)) {
            return `
Style examples for ages 9-10:

Input: "Tell Edi that his behavior in the Discord server was not acceptable and that he needs to explain what happened."
Output style:
Hi Edi,
Your behavior in the Discord server was not okay.
Please explain what happened and why you acted like that.
We need to understand the situation before deciding what happens next.

Input: "Tell him that he needs to be more respectful to other staff members."
Output style:
Hi,
Please be more respectful to the other staff members.
We want everyone in the team to talk to each other in a nice and fair way.
If this continues, there may be consequences.

Input: "Tell someone that their application looks interesting, but we need more details about their experience."
Output style:
Hi,
Your application looks interesting.
Before we can make a decision, we need a bit more information about your experience.
Please tell us what you have done before and why you think you would be a good fit.

Input: "Reply to a DM and ask when the person would be available for a short talk."
Output style:
Hi,
Thanks for your message.
When would you be available for a short talk?
Please send us a time that works for you.`;
        }

        if (["11", "12", "13"].includes(normalized)) {
            return `
Style examples for ages 11-13:

Input: "Tell Edi that his recent behavior has been reported and that we need his side of the story."
Output style:
Hi Edi,
Your recent behavior has been reported to the management team.
Before we make any decision, we would like to hear your side of the story.
Please explain what happened and why the situation escalated.

Input: "Tell him that being toxic towards members is not allowed and that he needs to improve his behavior."
Output style:
Hi,
We want to remind you that being toxic towards members is not allowed.
You are expected to treat others with respect, even during disagreements.
Please improve your behavior going forward, otherwise further action may be taken.

Input: "Tell someone that their job application was good, but they should add more details about their skills."
Output style:
Hello,
Thank you for your application.
Your application looks good overall, but we would like to see more details about your skills and previous experience.
Please tell us more about what you can do and why you believe you are suitable for the position.

Input: "Write a DM asking someone to stop spamming because it is disturbing other users."
Output style:
Hi,
Please stop spamming in the chat.
It is disturbing other users and makes the conversation harder to follow.
If you continue, we may have to take action.
Thank you for understanding.`;
        }

        if (["14", "15"].includes(normalized)) {
            return `
Style examples for ages 14-15:

Input: "Tell Edi that his behavior as a staff member was unprofessional and that he needs to improve immediately."
Output style:
Hi Edi,
We would like to address your recent behavior as a staff member.
The way you acted was unprofessional and does not meet the standards we expect from our team.
Please make sure to improve your behavior immediately and communicate with others in a more respectful and mature way.
If this continues, further consequences may be considered.

Input: "Tell him that he should stop arguing with users in public channels and handle issues calmly."
Output style:
Hi,
Please avoid arguing with users in public channels.
As a staff member, you are expected to handle situations calmly and professionally.
If there is an issue, try to de-escalate the situation or move the discussion to a private channel instead.
Continued public arguments may lead to further action.

Input: "Reply to an applicant and tell them that we liked their application, but we need to schedule an interview first."
Output style:
Hello,
Thank you for your application.
We reviewed it and found it interesting. However, before making a final decision, we would like to schedule a short interview with you.
Please let us know when you are available so we can arrange a suitable time.
We look forward to speaking with you.

Input: "Write a professional DM telling someone that we cannot accept their request right now, but they can try again later."
Output style:
Hello,
Thank you for reaching out.
Unfortunately, we cannot accept your request at this time.
You are welcome to try again in the future if the situation changes or if you can provide additional information.
Thank you for your understanding.`;
        }

        if (normalized === "16") {
            return `
Style examples for age 16:

Input: "Tell Edi that his recent behavior has damaged trust within the team and that he needs to explain himself."
Output style:
Hi Edi,
We need to address your recent behavior.
Your actions have created concerns and damaged trust within the team.
Before any final decision is made, we would like you to explain your side of the situation clearly and honestly.
Please take this seriously, as your response will be considered when deciding the next steps.

Input: "Tell him that his staff position requires maturity and that his current behavior does not reflect that."
Output style:
Hi,
Your staff position requires maturity, responsibility, and respectful communication.
Unfortunately, your recent behavior has not reflected those expectations.
We need you to improve immediately and show that you can handle your role properly.
If this behavior continues, we may have to reconsider your position within the team.

Input: "Reply to an applicant and explain that their application was strong, but another candidate was more suitable."
Output style:
Hello,
Thank you for your application and for the time you invested in the process.
Your application was strong and showed clear effort. However, after reviewing all candidates, we decided to move forward with another applicant who currently fits the position more closely.
This decision does not mean your application was poor. We appreciate your interest and encourage you to apply again in the future if another opportunity becomes available.
We wish you all the best.

Input: "Write a DM asking someone to clarify their offer because some important details are missing."
Output style:
Hello,
Thank you for your message.
Before we can properly evaluate your offer, we would need a few more details.
Please clarify what exactly you are offering, what you expect in return, and how this would benefit both sides.
Once we have that information, we can review it properly and give you a clear response.`;
        }

        return `
PRO style reference:
- Keep the current EnhancedTexts professional Detailed Mode quality.
- Do not simplify wording because of age personalisation.
- Use mature, natural, well-structured, professional Discord communication.
- Add detail, polish, formatting, and high-quality explanations when useful.`;
    }

    extractOutputText(body) {
        if (typeof body?.output_text === "string") return body.output_text;
        if (!Array.isArray(body?.output)) return "";

        return body.output
            .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
            .filter((part) => part?.type === "output_text" && typeof part.text === "string")
            .map((part) => part.text)
            .join("\n");
    }

    async readJsonResponse(response) {
        try {
            return await response.json();
        } catch {
            return {};
        }
    }

    createApiError(status, body) {
        const error = new Error(body?.error?.message || `OpenAI request failed with status ${status}.`);
        error.status = status;
        error.code = body?.error?.code || body?.error?.type || "API_ERROR";
        return error;
    }

    getUserError(error) {
        if (error?.code === "EMPTY_RESPONSE") return this.messages.emptyResponse;
        if (error?.status === 401 || error?.code === "invalid_api_key") return this.messages.invalidKey;
        if (error?.status === 429 || error?.code === "rate_limit_exceeded") return this.messages.rateLimit;
        if (error?.status >= 500 || error?.name === "TypeError") return this.messages.requestFailed;
        return this.messages.unknown;
    }

    logError(context, error) {
        const safe = {
            name: error?.name,
            message: this.redactSecrets(error?.message || String(error)),
            status: error?.status,
            code: error?.code,
            stack: this.redactSecrets(error?.stack || "")
        };
        this.api.Logger.error(context, safe);
    }

    redactSecrets(value) {
        let result = String(value || "");
        const keys = [
            this.getOpenAiApiKey()
        ].filter(Boolean);
        for (const key of keys) {
            result = result.split(key).join("[REDACTED]");
        }
        return result.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
    }

    escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    truncatePreview(value, maxLength = 100) {
        const text = String(value || "").replace(/\s+/g, " ").trim();
        if (text.length <= maxLength) return text;
        return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}â€¦`;
    }

    setModalStatus(modal, message, type) {
        const status = modal.querySelector(".enhancedtexts-status");
        status.textContent = message;
        status.className = `enhancedtexts-status visible ${type}`;
    }

    hasApiKey() {
        return Boolean(this.getOpenAiApiKey());
    }

    async copyText(text, showToast = true) {
        if (!text) return false;

        try {
            await navigator.clipboard.writeText(text);
            if (showToast) this.showToast("Improved text copied to clipboard.", "success");
            return true;
        } catch (error) {
            this.logError("Clipboard write failed", error);
            this.showToast("EnhancedTexts could not copy the text.", "error");
            return false;
        }
    }

    insertIntoTextbox(text, showToast = true) {
        const textbox = this.findTextbox();
        if (!textbox) {
            this.showToast(this.messages.textboxMissing, "error");
            return false;
        }

        try {
            textbox.focus();

            if (textbox instanceof HTMLTextAreaElement || textbox instanceof HTMLInputElement) {
                this.setNativeInputValue(textbox, text);
            } else {
                const normalizedText = text.replace(/\r\n?/g, "\n");
                const slate = this.getSlateEditor(textbox);

                if (slate) this.replaceSlateEditorText(slate, normalizedText);
                else this.insertWithComposerFallback(textbox, normalizedText);
            }

            requestAnimationFrame(() => {
                const activeTextbox = this.findTextbox();
                activeTextbox?.focus();
                this.moveCaretToEnd(activeTextbox);
            });
            if (showToast) this.showToast("Improved text inserted. Review it before sending.", "success");
            return true;
        } catch (error) {
            this.logError("Textbox insertion failed", error);
            this.showToast(this.messages.textboxMissing, "error");
            return false;
        }
    }

    setNativeInputValue(textbox, text) {
        const prototype = textbox instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

        if (!setter) throw new Error("Native input value setter is unavailable.");

        setter.call(textbox, text);
        textbox.dispatchEvent(new InputEvent("input", {
            bubbles: true,
            inputType: "insertReplacementText",
            data: text
        }));
        textbox.dispatchEvent(new Event("change", {bubbles: true}));
    }

    getSlateEditor(textbox) {
        const candidates = [
            textbox,
            textbox.parentElement,
            textbox.closest("[class*='textArea']"),
            textbox.closest("[class*='channelTextArea']")
        ].filter(Boolean);

        for (const candidate of candidates) {
            const owner = this.api.ReactUtils.getOwnerInstance(candidate);
            const refs = [
                owner,
                owner?.ref?.current,
                owner?.props,
                owner?.stateNode,
                owner?.stateNode?.ref?.current
            ].filter(Boolean);

            for (const ref of refs) {
                const editor = ref?.getSlateEditor?.()
                    || ref?.editor
                    || ref?.props?.editor;
                if (editor && typeof editor.insertText === "function") return editor;
            }
        }

        return null;
    }

    replaceSlateEditorText(editor, text) {
        const start = this.getSlateDocumentEdge(editor, "start");
        const end = this.getSlateDocumentEdge(editor, "end");

        if (start && end) {
            const range = {anchor: start, focus: end};
            if (typeof editor.select === "function") editor.select(range);
            else editor.selection = range;

            if (typeof editor.deleteFragment === "function") editor.deleteFragment();
        }

        editor.insertText(text);
    }

    getSlateDocumentEdge(editor, edge) {
        if (!Array.isArray(editor.children) || !editor.children.length) return null;

        const path = edge === "start"
            ? this.findSlateTextPath(editor.children, false)
            : this.findSlateTextPath(editor.children, true);
        if (!path) return null;

        const node = path.reduce((current, index) => current?.children?.[index], {children: editor.children});
        return {
            path,
            offset: edge === "start" ? 0 : String(node?.text || "").length
        };
    }

    findSlateTextPath(children, fromEnd, prefix = []) {
        const indexes = [...children.keys()];
        if (fromEnd) indexes.reverse();

        for (const index of indexes) {
            const node = children[index];
            const path = [...prefix, index];
            if (typeof node?.text === "string") return path;
            if (Array.isArray(node?.children)) {
                const nested = this.findSlateTextPath(node.children, fromEnd, path);
                if (nested) return nested;
            }
        }

        return null;
    }

    insertWithComposerFallback(textbox, text) {
        this.selectComposerContents(textbox);

        if (!document.execCommand("insertText", false, text)) {
            if (!this.componentDispatch?.dispatchToLastSubscribed) this.resolveDiscordModules();
            if (!this.componentDispatch?.dispatchToLastSubscribed) {
                throw new Error("Discord composer editor is unavailable.");
            }

            this.componentDispatch.dispatchToLastSubscribed("INSERT_TEXT", {
                content: text,
                plainText: text
            });
        }
    }

    selectComposerContents(textbox) {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(textbox);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    moveCaretToEnd(textbox) {
        if (!textbox || textbox instanceof HTMLTextAreaElement || textbox instanceof HTMLInputElement) {
            if (textbox?.setSelectionRange) {
                const end = textbox.value.length;
                textbox.setSelectionRange(end, end);
            }
            return;
        }

        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(textbox);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    showToast(message, type = "info") {
        this.api.UI.showToast(message, {type, timeout: 5000});
    }

    getSettingsPanel() {
        this.loadSettings();

        const panel = document.createElement("div");
        panel.className = "enhancedtexts-settings";
        panel.innerHTML = `
            <h2>EnhancedTexts Settings</h2>
            <p class="enhancedtexts-settings-description">
                Configure how EnhancedTexts prepares announcements, support replies, and direct messages.
            </p>

            <section class="enhancedtexts-setting">
                <div class="enhancedtexts-setting-title">Activation Key</div>
                <div class="enhancedtexts-setting-note">Required for EnhancedTexts access. The key is validated through the HubManager backend.</div>
                <div class="enhancedtexts-key-row">
                    <input class="enhancedtexts-input enhancedtexts-activation-key" type="password" autocomplete="off" spellcheck="false" maxlength="32" placeholder="Enter your activation key...">
                    <button class="enhancedtexts-btn enhancedtexts-show-activation-key" type="button">Show</button>
                    <button class="enhancedtexts-btn primary enhancedtexts-save-activation-key" type="button">Save Key</button>
                    <button class="enhancedtexts-btn enhancedtexts-test-activation-key" type="button">Test Key</button>
                </div>
                <div class="enhancedtexts-setting-note enhancedtexts-activation-result"></div>
            </section>

            ${this.settingsToggle(
                "Strict token blocking",
                "Block generation when the estimated request exceeds the remaining activation-key token balance.",
                "strictTokenBlocking"
            )}

            ${this.settingsSelect(
                "Default mode",
                "Choose which rewrite mode opens by default.",
                "defaultMode",
                [
                    ["announcement", "Discord Announcement"],
                    ["support", "Support Ticket"],
                    ["direct", "Direct Message"],
                    ["ask", "Ask every time"]
                ]
            )}

            ${this.settingsSelect(
                "Default language",
                "Choose the output language used when EnhancedTexts opens.",
                "outputLanguage",
                [
                    ["german", "German"],
                    ["english", "English"],
                    ["french", "French"],
                    ["russian", "Russian"],
                    ["spanish", "Spanish"],
                    ["chinese-mandarin", "Chinese (Mandarin)"],
                    ["hindi", "Hindi"],
                    ["arabic", "Arabic"],
                    ["japanese", "Japanese"],
                    ["portuguese", "Portuguese"]
                ]
            )}

            ${this.settingsToggle(
                "Automatically insert generated text",
                "Place the result in Discord's message box after generation. It is never sent automatically.",
                "autoInsert"
            )}

            ${this.settingsToggle(
                "Automatically copy generated text",
                "Copy each successful result to the clipboard.",
                "autoCopy"
            )}

            ${this.settingsToggle(
                "Logical Message React",
                "Use the message you are replying to as context and generate a response that follows your instruction.",
                "logicalMessageReact"
            )}

            ${this.settingsToggle(
                "Use emojis in announcements",
                "Add lively, topic-matching emojis to titles, sections, important lines, and useful bullet points.",
                "useEmojis"
            )}

            ${this.settingsToggle(
                "Use Discord markdown formatting",
                "Allow headings, bold text, lists, and other Discord-friendly formatting.",
                "useMarkdown"
            )}

            ${this.settingsSelect(
                "Response length",
                "Controls the target detail and maximum output size.",
                "responseLength",
                [
                    ["short", "Short"],
                    ["medium", "Medium"],
                    ["detailed", "Detailed"]
                ]
            )}

            <div class="enhancedtexts-settings-actions">
                <button class="enhancedtexts-btn danger enhancedtexts-reset" type="button">Reset Settings</button>
            </div>
        `;

        const reset = panel.querySelector(".enhancedtexts-reset");
        const activationInput = panel.querySelector(".enhancedtexts-activation-key");
        const showActivation = panel.querySelector(".enhancedtexts-show-activation-key");
        const saveActivation = panel.querySelector(".enhancedtexts-save-activation-key");
        const testActivation = panel.querySelector(".enhancedtexts-test-activation-key");
        const activationResult = panel.querySelector(".enhancedtexts-activation-result");

        activationInput.value = this.getActivationKey();

        showActivation.addEventListener("click", () => {
            const reveal = activationInput.type === "password";
            activationInput.type = reveal ? "text" : "password";
            showActivation.textContent = reveal ? "Hide" : "Show";
        });

        saveActivation.addEventListener("click", async () => {
            await this.saveActivationKeyFromInput(activationInput.value, activationResult, false);
            activationInput.value = this.getActivationKey();
        });

        testActivation.addEventListener("click", async () => {
            testActivation.disabled = true;
            testActivation.innerHTML = '<span class="enhancedtexts-spinner"></span>Testing';

            try {
                await this.saveActivationKeyFromInput(activationInput.value, activationResult, true);
                activationInput.value = this.getActivationKey();
            } finally {
                testActivation.disabled = false;
                testActivation.textContent = "Test Key";
            }
        });

        panel.querySelectorAll("[data-setting]").forEach((control) => {
            control.addEventListener("change", () => {
                const key = control.dataset.setting;
                this.settings[key] = control.type === "checkbox" ? control.checked : control.value;
                this.saveSettings();
            });
        });

        reset.addEventListener("click", () => this.confirmReset(panel));
        return panel;
    }

    settingsToggle(title, note, key) {
        return `
            <section class="enhancedtexts-setting">
                <div class="enhancedtexts-setting-row">
                    <div class="enhancedtexts-setting-copy">
                        <div class="enhancedtexts-setting-title">${title}</div>
                        <div class="enhancedtexts-setting-note">${note}</div>
                    </div>
                    <input class="enhancedtexts-toggle" data-setting="${key}" type="checkbox" ${this.settings[key] ? "checked" : ""}>
                </div>
            </section>
        `;
    }

    settingsSelect(title, note, key, options) {
        const optionHtml = options.map(([value, label]) => (
            `<option value="${value}" ${this.settings[key] === value ? "selected" : ""}>${label}</option>`
        )).join("");

        return `
            <section class="enhancedtexts-setting">
                <div class="enhancedtexts-setting-row">
                    <div class="enhancedtexts-setting-copy">
                        <div class="enhancedtexts-setting-title">${title}</div>
                        <div class="enhancedtexts-setting-note">${note}</div>
                    </div>
                    <select class="enhancedtexts-select" data-setting="${key}" style="max-width: 240px">${optionHtml}</select>
                </div>
            </section>
        `;
    }

    async testApiKey(key) {
        const response = await this.api.Net.fetch("https://api.openai.com/v1/models/gpt-5.5", {
            method: "GET",
            headers: {"Authorization": `Bearer ${key}`},
            timeout: 30000
        });

        const body = await this.readJsonResponse(response);
        if (!response.ok) throw this.createApiError(response.status, body);
        return true;
    }

    confirmReset(panel) {
        const message = "This will restore all visible EnhancedTexts settings to their defaults.";

        this.api.UI.showConfirmationModal("Reset EnhancedTexts?", message, {
            confirmText: "Reset",
            cancelText: "Cancel",
            onConfirm: () => {
                this.settings = this.normalizeSettings({...this.defaults});
                this.saveSettings();
                this.showToast("EnhancedTexts settings were reset.", "success");

                const replacement = this.getSettingsPanel();
                panel.replaceWith(replacement);
            }
        });
    }
};

