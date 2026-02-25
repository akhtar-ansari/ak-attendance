// AK Attendance - Sync Indicator (Top Right Corner)
const SyncIndicator = {
    element: null,

    // Create the indicator element
    init() {
        if (this.element) return;

        this.element = document.createElement('div');
        this.element.id = 'syncIndicator';
        this.element.innerHTML = `
            <div class="sync-spinner"></div>
            <span class="sync-text">Syncing...</span>
        `;
        this.element.style.cssText = `
            position: fixed;
            top: 15px;
            right: 15px;
            background: rgba(102, 126, 234, 0.95);
            color: white;
            padding: 10px 18px;
            border-radius: 25px;
            font-size: 13px;
            font-weight: 500;
            display: none;
            align-items: center;
            gap: 10px;
            z-index: 9999;
            box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
            font-family: 'Segoe UI', sans-serif;
        `;

        const style = document.createElement('style');
        style.textContent = `
            .sync-spinner {
                width: 16px;
                height: 16px;
                border: 2px solid rgba(255,255,255,0.3);
                border-top-color: white;
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
            }
            @keyframes spin {
                to { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
        document.body.appendChild(this.element);
    },

    // Show with custom message
    show(message = 'Syncing...') {
        this.init();
        this.element.querySelector('.sync-text').textContent = message;
        this.element.style.display = 'flex';
    },

    // Hide
    hide() {
        if (this.element) {
            this.element.style.display = 'none';
        }
    }
};