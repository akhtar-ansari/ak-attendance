// AK Attendance - Authentication Module
const AUTH = {
    SESSION_KEY: 'ak_attendance_session',

    // Login user
    async login(username, password) {
        try {
            const { data, error } = await supabaseClientClient
                .from('users')
                .select('id, username, password_hash, name, role, department_id, status')
                .eq('username', username.toLowerCase().trim())
                .eq('status', 'active')
                .single();

            if (error || !data) {
                return { success: false, error: 'User not found' };
            }

            if (data.password_hash !== password) {
                return { success: false, error: 'Invalid password' };
            }

            // Create session
            const session = {
                userId: data.id,
                username: data.username,
                name: data.name,
                role: data.role,
                departmentId: data.department_id,
                loginTime: new Date().toISOString()
            };

            localStorage.setItem(this.SESSION_KEY, JSON.stringify(session));

            // Audit log
            await this.logAction('LOGIN', 'users', data.id, null, { username: data.username });

            return { success: true, user: session };
        } catch (error) {
            console.error('Login error:', error);
            return { success: false, error: 'Login failed. Check internet connection.' };
        }
    },

    // Logout
    async logout() {
        const session = this.getSession();
        if (session) {
            await this.logAction('LOGOUT', 'users', session.userId, null, { username: session.username });
        }
        localStorage.removeItem(this.SESSION_KEY);
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

    // Log action to audit log
    async logAction(action, tableName, recordId, oldValue, newValue) {
        try {
            const session = this.getSession();
            await supabaseClientClientClient.from('audit_log').insert({
                user_id: session?.userId || null,
                user_name: session?.name || 'System',
                action: action,
                table_name: tableName,
                record_id: recordId?.toString() || null,
                old_value: oldValue,
                new_value: newValue
            });
        } catch (error) {
            console.error('Audit log error:', error);
        }
    }
};