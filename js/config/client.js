// ============================================
// ARWA ENTERPRISES - CLIENT HELPER
// Multi-client support functions
// ============================================

// AK Company ID (your existing client)
const AK_CLIENT_ID = '00000000-0000-0000-0000-000000000001';

// Get current client ID from localStorage
function getClientId() {
    return localStorage.getItem('client_id') || AK_CLIENT_ID;
}

// Get current client info
function getClientInfo() {
    return {
        id: localStorage.getItem('client_id') || AK_CLIENT_ID,
        name: localStorage.getItem('client_name') || 'M.A. Al Abdul Karim & Co',
        logo: localStorage.getItem('client_logo') || null
    };
}

// Set client info after login
function setClientInfo(clientId, clientName, clientLogo) {
    localStorage.setItem('client_id', clientId);
    localStorage.setItem('client_name', clientName);
    if (clientLogo) {
        localStorage.setItem('client_logo', clientLogo);
    }
}

// Clear client info on logout
function clearClientInfo() {
    localStorage.removeItem('client_id');
    localStorage.removeItem('client_name');
    localStorage.removeItem('client_logo');
}

// Check if trial expired
async function checkTrialStatus() {
    const clientId = getClientId();
    const { data, error } = await supabase
        .from('clients')
        .select('plan, trial_ends_at, subscription_ends_at, is_active')
        .eq('id', clientId)
        .single();
    
    if (error || !data) return { valid: false, reason: 'Client not found' };
    
    if (!data.is_active) return { valid: false, reason: 'Account deactivated' };
    
    const now = new Date();
    
    if (data.plan === 'trial') {
        const trialEnd = new Date(data.trial_ends_at);
        if (now > trialEnd) {
            return { valid: false, reason: 'Trial expired' };
        }
    }
    
    if (data.plan === 'paid' && data.subscription_ends_at) {
        const subEnd = new Date(data.subscription_ends_at);
        if (now > subEnd) {
            return { valid: false, reason: 'Subscription expired' };
        }
    }
    
    return { valid: true };
}

// Export for use in other files
window.ClientHelper = {
    getClientId,
    getClientInfo,
    setClientInfo,
    clearClientInfo,
    checkTrialStatus,
    AK_CLIENT_ID
};