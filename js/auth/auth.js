// AK Attendance - Authentication Module
// Updated for Multi-Client Support (Arwa Enterprises SaaS)

const AUTH = {
    SESSION_KEY: 'ak_attendance_session',
    
    // Default AK Client ID (for backward compatibility)
    AK_CLIENT_ID: '00000000-0000-0000-0000-000000000001',

    // Login user
    async login(username, password) {
        try {
            const { data, error } = await supabaseClient
                .from('users')
                .select('id, username, password_hash, name, role, department_id, status, client_id')
                .eq('username', username.toLowerCase().trim())
                .eq('status', 'active')
                .single();

            if (error || !data) {
                return { success: false, error: 'User not found' };
            }

            if (data.password_hash !== password) {
                return { success: false, error: 'Invalid password' };
            }

            // Get client info
            const clientId = data.client_id || this.AK_CLIENT_ID;
            const { data: clientData, error: clientError } = await supabaseClient
                .from('clients')
                .select('id, business_name, business_name_ar, logo_url, plan, trial_ends_at, subscription_ends_at, is_active')
                .eq('id', clientId)
                .single();

            // Check if client is active
            if (clientError || !clientData) {
                return { success: false, error: 'Client account not found' };
            }

            if (!clientData.is_active) {
                return { success: false, error: 'Your account has been deactivated. Please contact support.' };
            }

            // Check trial/subscription status
            const subscriptionCheck = this.checkSubscriptionStatus(clientData);
            if (!subscriptionCheck.valid) {
                return { success: false, error: subscriptionCheck.message };
            }

            // Create session with client info
            const session = {
                userId: data.id,
                username: data.username,
                name: data.name,
                role: data.role,
                departmentId: data.department_id,
                clientId: clientId,
                clientName: clientData.business_name,
                clientNameAr: clientData.business_name_ar,
                clientLogo: clientData.logo_url,
                clientPlan: clientData.plan,
                loginTime: new Date().toISOString()
            };

            localStorage.setItem(this.SESSION_KEY, JSON.stringify(session));
            
            // Also store client info separately for easy access
            localStorage.setItem('client_id', clientId);
            localStorage.setItem('client_name', clientData.business_name);
            if (clientData.logo_url) {
                localStorage.setItem('client_logo', clientData.logo_url);
            }

            // Audit log
            await this.logAction('LOGIN', 'users', data.id, null, { 
                username: data.username,
                client_id: clientId 
            });

            return { success: true, user: session };
        } catch (error) {
            console.error('Login error:', error);
            return { success: false, error: 'Login failed. Check internet connection.' };
        }
    },

    // Check subscription status
    checkSubscriptionStatus(clientData) {
        const now = new Date();
        
        // Premium clients (like AK) have no expiry check
        if (clientData.plan === 'premium') {
            return { valid: true };
        }
        
        // Trial check
        if (clientData.plan === 'trial') {
            if (clientData.trial_ends_at) {
                const trialEnd = new Date(clientData.trial_ends_at);
                if (now > trialEnd) {
                    return { 
                        valid: false, 
                        message: 'Your trial has expired. Please subscribe to continue using the service.' 
                    };
                }
            }
            return { valid: true };
        }
        
        // Paid subscription check
        if (clientData.plan === 'paid' || clientData.plan === 'basic' || clientData.plan === 'standard') {
            if (clientData.subscription_ends_at) {
                const subEnd = new Date(clientData.subscription_ends_at);
                if (now > subEnd) {
                    return { 
                        valid: false, 
                        message: 'Your subscription has expired. Please renew to continue using the service.' 
                    };
                }
            }
            return { valid: true };
        }
        
        return { valid: true };
    },

    // Logout
    async logout() {
        const session = this.getSession();
        if (session) {
            await this.logAction('LOGOUT', 'users', session.userId, null, { 
                username: session.username,
                client_id: session.clientId 
            });
        }
        
        // Clear all session data
        localStorage.removeItem(this.SESSION_KEY);
        localStorage.removeItem('client_id');
        localStorage.removeItem('client_name');
        localStorage.removeItem('client_logo');
        
        window.location.href = this.getBasePath() + 'index.html';
    },

    // Get current session
    getSession() {
        const session = localStorage.getItem(this.SESSION_KEY);
        return session ? JSON.parse(session) : null;
    },

    // Check if logged in
    isLoggedIn() {
        return this.getSession() !== null;
    },

    // Get current client ID
    getClientId() {
        const session = this.getSession();
        return session?.clientId || localStorage.getItem('client_id') || this.AK_CLIENT_ID;
    },

    // Get current client info
    getClientInfo() {
        const session = this.getSession();
        return {
            id: session?.clientId || localStorage.getItem('client_id') || this.AK_CLIENT_ID,
            name: session?.clientName || localStorage.getItem('client_name') || 'M.A. Al Abdul Karim & Co',
            nameAr: session?.clientNameAr || null,
            logo: session?.clientLogo || localStorage.getItem('client_logo') || null,
            plan: session?.clientPlan || 'premium'
        };
    },

    // Get base path (handles subfolder URLs)
    getBasePath() {
        const path = window.location.pathname;
        if (path.includes('/admin/') || path.includes('/labor/') || 
            path.includes('/attendance/') || path.includes('/reports/') || 
            path.includes('/punch/')) {
            return '../';
        }
        return '';
    },

    // Require login (redirect if not logged in)
    requireLogin() {
        if (!this.isLoggedIn()) {
            window.location.href = this.getBasePath() + 'index.html';
            return false;
        }
        return true;
    },

    // Check if user has specific role
    hasRole(allowedRoles) {
        const session = this.getSession();
        if (!session) return false;
        
        if (typeof allowedRoles === 'string') {
            allowedRoles = [allowedRoles];
        }
        
        return allowedRoles.includes(session.role);
    },

    // Check if user can access department
    canAccessDepartment(departmentId) {
        const session = this.getSession();
        if (!session) return false;
        
        // Super admin can access all
        if (session.role === 'super_admin') return true;
        
        // Others can only access their department
        return session.departmentId === departmentId;
    },

    // Require specific role (redirect if not allowed)
    requireRole(allowedRoles) {
        if (!this.requireLogin()) return false;
        
        if (!this.hasRole(allowedRoles)) {
            alert('Access denied. You do not have permission to view this page.');
            window.location.href = this.getBasePath() + 'dashboard.html';
            return false;
        }
        return true;
    },

    // Get department filter for queries
    getDepartmentFilter() {
        const session = this.getSession();
        if (!session) return null;
        
        // Super admin sees all
        if (session.role === 'super_admin') return null;
        
        // Others see only their department
        return session.departmentId;
    },

    // Log action to audit log (now includes client_id)
    async logAction(action, tableName, recordId, oldValue, newValue) {
        try {
            const session = this.getSession();
            const clientId = this.getClientId();
            
            await supabaseClient.from('audit_log').insert({
                user_id: session?.userId || null,
                user_name: session?.name || 'System',
                action: action,
                table_name: tableName,
                record_id: recordId?.toString() || null,
                old_value: oldValue,
                new_value: newValue,
                client_id: clientId
            });
        } catch (error) {
            console.error('Audit log error:', error);
        }
    },

    // Display client branding on page
    displayClientBranding() {
        const clientInfo = this.getClientInfo();
        
        // Update company name if element exists
        const nameElement = document.getElementById('company-name');
        if (nameElement) {
            nameElement.textContent = clientInfo.name;
        }
        
        // Update company logo if element exists
        const logoElement = document.getElementById('company-logo');
        if (logoElement && clientInfo.logo) {
            logoElement.src = clientInfo.logo;
            logoElement.style.display = 'block';
        }
        
        // Update page title
        document.title = document.title.replace('AK Attendance', clientInfo.name + ' - Attendance');
    }
};

// Auto-display client branding when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    if (AUTH.isLoggedIn()) {
        AUTH.displayClientBranding();
    }
});
