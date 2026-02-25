// AK Attendance - User API
const UserAPI = {
    // Get all users (Super Admin only)
    async getAll() {
        try {
            if (!AUTH.hasRole('super_admin')) {
                return { success: false, error: 'Access denied' };
            }

            const { data, error } = await supabase
                .from('users')
                .select(`
                    id,
                    username,
                    name,
                    role,
                    department_id,
                    status,
                    created_at,
                    departments:department_id (id, name, code)
                `)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return { success: true, data: data || [] };
        } catch (error) {
            console.error('Get users error:', error);
            return { success: false, error: error.message };
        }
    },

    // Get user by ID
    async getById(id) {
        try {
            const { data, error } = await supabase
                .from('users')
                .select(`
                    id,
                    username,
                    name,
                    role,
                    department_id,
                    status,
                    departments:department_id (id, name, code)
                `)
                .eq('id', id)
                .single();

            if (error) throw error;
            return { success: true, data };
        } catch (error) {
            console.error('Get user error:', error);
            return { success: false, error: error.message };
        }
    },

    // Create new user (Super Admin only)
    async create(user) {
        try {
            if (!AUTH.hasRole('super_admin')) {
                return { success: false, error: 'Access denied' };
            }

            // Check if username exists
            const { data: existing } = await supabase
                .from('users')
                .select('id')
                .eq('username', user.username.toLowerCase().trim())
                .single();

            if (existing) {
                return { success: false, error: 'Username already exists' };
            }

            // Validate role and department
            if (user.role !== 'super_admin' && !user.departmentId) {
                return { success: false, error: 'Department is required for Admin and Supervisor' };
            }

            const { data, error } = await supabase
                .from('users')
                .insert({
                    username: user.username.toLowerCase().trim(),
                    password_hash: user.password,
                    name: user.name.trim(),
                    role: user.role,
                    department_id: user.role === 'super_admin' ? null : user.departmentId,
                    status: user.status || 'active'
                })
                .select(`
                    id,
                    username,
                    name,
                    role,
                    department_id,
                    status,
                    departments:department_id (id, name, code)
                `)
                .single();

            if (error) throw error;

            await AUTH.logAction('CREATE', 'users', data.id, null, { ...data, password_hash: '***' });

            return { success: true, data };
        } catch (error) {
            console.error('Create user error:', error);
            return { success: false, error: error.message };
        }
    },

    // Update user
    async update(id, updates) {
        try {
            if (!AUTH.hasRole('super_admin')) {
                return { success: false, error: 'Access denied' };
            }

            const { data: oldData } = await supabase
                .from('users')
                .select('*')
                .eq('id', id)
                .single();

            const updateObj = {};
            if (updates.name) updateObj.name = updates.name.trim();
            if (updates.role) updateObj.role = updates.role;
            if (updates.departmentId !== undefined) {
                updateObj.department_id = updates.role === 'super_admin' ? null : updates.departmentId;
            }
            if (updates.status) updateObj.status = updates.status;
            if (updates.password) updateObj.password_hash = updates.password;

            const { data, error } = await supabase
                .from('users')
                .update(updateObj)
                .eq('id', id)
                .select(`
                    id,
                    username,
                    name,
                    role,
                    department_id,
                    status,
                    departments:department_id (id, name, code)
                `)
                .single();

            if (error) throw error;

            await AUTH.logAction('UPDATE', 'users', id, 
                { ...oldData, password_hash: '***' }, 
                { ...data, password_hash: '***' }
            );

            return { success: true, data };
        } catch (error) {
            console.error('Update user error:', error);
            return { success: false, error: error.message };
        }
    },

    // Delete user (soft delete - set inactive)
    async delete(id) {
        try {
            if (!AUTH.hasRole('super_admin')) {
                return { success: false, error: 'Access denied' };
            }

            // Prevent deleting yourself
            const session = AUTH.getSession();
            if (session.userId === id) {
                return { success: false, error: 'Cannot delete your own account' };
            }

            const { data: oldData } = await supabase
                .from('users')
                .select('*')
                .eq('id', id)
                .single();

            const { error } = await supabase
                .from('users')
                .update({ status: 'inactive' })
                .eq('id', id);

            if (error) throw error;

            await AUTH.logAction('DELETE', 'users', id, oldData, null);

            return { success: true };
        } catch (error) {
            console.error('Delete user error:', error);
            return { success: false, error: error.message };
        }
    },

    // Change password (for own account)
    async changePassword(currentPassword, newPassword) {
        try {
            const session = AUTH.getSession();

            // Verify current password
            const { data: user } = await supabase
                .from('users')
                .select('password_hash')
                .eq('id', session.userId)
                .single();

            if (user.password_hash !== currentPassword) {
                return { success: false, error: 'Current password is incorrect' };
            }

            const { error } = await supabase
                .from('users')
                .update({ password_hash: newPassword })
                .eq('id', session.userId);

            if (error) throw error;

            await AUTH.logAction('CHANGE_PASSWORD', 'users', session.userId, null, null);

            return { success: true };
        } catch (error) {
            console.error('Change password error:', error);
            return { success: false, error: error.message };
        }
    }
};