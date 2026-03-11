// AK Attendance - Authentication Module
// Updated for Multi-Client Support (Arwa Enterprises SaaS)

const AUTH = {
    SESSION_KEY: 'ak_attendance_session',
    
    // Default AK Client ID (for backward compatibility)
    AK_CLIENT_ID: '00000000-0000-0000-0000-000000000001',

// Login user with client code
async login(clientCode, username, password) {
    try {
        // First, find the client by code
        const { data: clientData, error: clientError } = await supabaseClient
            .from('clients')
            .select('id, business_name, business_name_ar, logo_url, subscription_status, subscription_tier, subscription_end_date, is_active')
            .eq('client_code', clientCode.toUpperCase().trim())
            .single();

        if (clientError || !clientData) {
            return { success: false, error: 'Invalid client code' };
        }

        if (!clientData.is_active) {
            return { success: false, error: 'This account has been deactivated. Contact support.' };
        }

        // Now find user belonging to this client
        const { data: userData, error: userError } = await supabaseClient
            .from('users')
            .select('id, username, password_hash, name, role, department_id, status, client_id')
            .eq('username', username.toLowerCase().trim())
            .eq('client_id', clientData.id)
            .eq('status', 'active')
            .single();

        if (userError || !userData) {
            return { success: false, error: 'User not found for this client' };
        }

        if (userData.password_hash !== password) {
            return { success: false, error: 'Invalid password' };
        }

        // Check subscription status
        const subscriptionCheck = this.checkSubscriptionStatus(clientData);
        if (!subscriptionCheck.valid) {
            return { success: false, error: subscriptionCheck.message };
        }

        // Create session with client info
        const session = {
            userId: userData.id,
            username: userData.username,
            name: userData.name,
            role: userData.role,
            departmentId: userData.department_id,
            clientId: clientData.id,
            clientCode: clientCode.toUpperCase().trim(),
            clientName: clientData.business_name,
            clientNameAr: clientData.business_name_ar,
            clientLogo: clientData.logo_url,
            clientTier: clientData.subscription_tier,
            clientStatus: clientData.subscription_status,
            loginTime: new Date().toISOString()
        };

        localStorage.setItem(this.SESSION_KEY, JSON.stringify(session));
        
        // Store client info separately for easy access
        localStorage.setItem('client_id', clientData.id);
        localStorage.setItem('client_code', clientCode.toUpperCase().trim());
        localStorage.setItem('client_name', clientData.business_name);
        if (clientData.logo_url) {
            localStorage.setItem('client_logo', clientData.logo_url);
        }

        // Audit log
        await this.logAction('LOGIN', 'users', userData.id, null, { 
            username: userData.username,
            client_id: clientData.id,
            client_code: clientCode
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
    
    // Premium clients have no expiry check
    if (clientData.subscription_status === 'premium') {
        return { valid: true };
    }
    
    // Check if expired
    if (clientData.subscription_status === 'expired') {
        return { 
            valid: false, 
            message: 'Your subscription has expired. Contact Arwa Enterprises: +91 7021229209' 
        };
    }
    
    // Check end date
    if (clientData.subscription_end_date) {
        const endDate = new Date(clientData.subscription_end_date);
        if (now > endDate) {
            return { 
                valid: false, 
                message: 'Your subscription has expired. Contact Arwa Enterprises: +91 7021229209' 
            };
        }
    }
    
    return { valid: true };
},
        
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
