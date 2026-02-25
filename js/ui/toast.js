// AK Attendance - Toast Notifications
const Toast = {
    container: null,

    // Initialize container
    init() {
        if (this.container) return;

        this.container = document.createElement('div');
        this.container.id = 'toastContainer';
        this.container.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: 10px;
            font-family: 'Segoe UI', sans-serif;
        `;
        document.body.appendChild(this.container);
    },

    // Show toast message
    show(message, type = 'info', duration = 3000) {
        this.init();

        const toast = document.createElement('div');
        
        const colors = {
            success: { bg: '#48bb78', icon: '✓' },
            error: { bg: '#f56565', icon: '✕' },
            warning: { bg: '#ed8936', icon: '⚠' },
            info: { bg: '#4299e1', icon: 'ℹ' }
        };

        const { bg, icon } = colors[type] || colors.info;

        toast.innerHTML = `<span style="margin-right:8px;">${icon}</span>${message}`;
        toast.style.cssText = `
            background: ${bg};
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
            display: flex;
            align-items: center;
            animation: slideIn 0.3s ease;
            max-width: 350px;
        `;

        // Add animation styles if not exists
        if (!document.getElementById('toastStyles')) {
            const style = document.createElement('style');
            style.id = 'toastStyles';
            style.textContent = `
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                @keyframes slideOut {
                    from { transform: translateX(0); opacity: 1; }
                    to { transform: translateX(100%); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }

        this.container.appendChild(toast);

        // Auto remove
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },

    // Shorthand methods
    success(message, duration) { this.show(message, 'success', duration); },
    error(message, duration) { this.show(message, 'error', duration); },
    warning(message, duration) { this.show(message, 'warning', duration); },
    info(message, duration) { this.show(message, 'info', duration); }
};