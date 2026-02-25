// AK Attendance - Date Utilities
const DateUtils = {
    // Format date as DD/MM/YYYY
    formatDate(date) {
        if (!date) return '-';
        const d = new Date(date);
        if (isNaN(d.getTime())) return '-';
        
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        return `${day}/${month}/${year}`;
    },

    // Format for input fields (YYYY-MM-DD)
    formatForInput(date) {
        if (!date) return '';
        const d = new Date(date);
        if (isNaN(d.getTime())) return '';
        return d.toISOString().split('T')[0];
    },

    // Format time as HH:MM:SS
    formatTime(time) {
        if (!time) return '-';
        if (typeof time === 'string' && time.includes(':')) {
            return time.substring(0, 8);
        }
        return time;
    },

    // Format time as HH:MM (short)
    formatTimeShort(time) {
        if (!time) return '-';
        if (typeof time === 'string' && time.includes(':')) {
            return time.substring(0, 5);
        }
        return time;
    },

    // Get today's date as YYYY-MM-DD
    today() {
        return new Date().toISOString().split('T')[0];
    },

    // Get current time as HH:MM:SS
    now() {
        return new Date().toTimeString().split(' ')[0];
    },

    // Get first day of current month
    firstDayOfMonth() {
        const d = new Date();
        return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
    },

    // Get last day of current month
    lastDayOfMonth() {
        const d = new Date();
        return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0];
    },

    // Check if date is Friday
    isFriday(date) {
        const d = new Date(date);
        return d.getDay() === 5;
    },

    // Get day name
    getDayName(date) {
        const d = new Date(date);
        return d.toLocaleDateString('en-US', { weekday: 'long' });
    },

    // Calculate hours between two times
    calculateHours(startTime, endTime) {
        if (!startTime || !endTime) return 0;
        
        const start = new Date(`2000-01-01T${startTime}`);
        const end = new Date(`2000-01-01T${endTime}`);
        
        const diffMs = end - start;
        const diffHours = diffMs / (1000 * 60 * 60);
        
        return Math.max(0, Math.round(diffHours * 100) / 100);
    }
};