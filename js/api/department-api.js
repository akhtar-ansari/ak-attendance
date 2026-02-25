// AK Attendance - Department API
const DepartmentAPI = {
    // Get all departments
    async getAll() {
        try {
            const { data, error } = await supabaseClient
                .from('departments')
                .select('*')
                .order('name');

            if (error) throw error;
            return { success: true, data: data || [] };
        } catch (error) {
            console.error('Get departments error:', error);
            return { success: false, error: error.message };
        }
    },

    // Get active departments only
    async getActive() {
        try {
            const { data, error } = await supabaseClient
                .from('departments')
                .select('*')
                .eq('status', 'active')
                .order('name');

            if (error) throw error;
            return { success: true, data: data || [] };
        } catch (error) {
            console.error('Get active departments error:', error);
            return { success: false, error: error.message };
        }
    },

    // Get single department by ID
    async getById(id) {
        try {
            const { data, error } = await supabaseClient
                .from('departments')
                .select('*')
                .eq('id', id)
                .single();

            if (error) throw error;
            return { success: true, data };
        } catch (error) {
            console.error('Get department error:', error);
            return { success: false, error: error.message };
        }
    },

    // Create new department
    async create(department) {
        try {
            const { data, error } = await supabaseClient
                .from('departments')
                .insert({
                    name: department.name.trim(),
                    code: department.code.toUpperCase().trim(),
                    status: department.status || 'active'
                })
                .select()
                .single();

            if (error) throw error;

            // Audit log
            await AUTH.logAction('CREATE', 'departments', data.id, null, data);

            return { success: true, data };
        } catch (error) {
            console.error('Create department error:', error);
            return { success: false, error: error.message };
        }
    },

    // Update department
    async update(id, updates) {
        try {
            // Get old value for audit
            const { data: oldData } = await supabaseClient
                .from('departments')
                .select('*')
                .eq('id', id)
                .single();

            const { data, error } = await supabaseClient
                .from('departments')
                .update({
                    name: updates.name?.trim(),
                    code: updates.code?.toUpperCase().trim(),
                    status: updates.status
                })
                .eq('id', id)
                .select()
                .single();

            if (error) throw error;

            // Audit log
            await AUTH.logAction('UPDATE', 'departments', id, oldData, data);

            return { success: true, data };
        } catch (error) {
            console.error('Update department error:', error);
            return { success: false, error: error.message };
        }
    },

    // Delete department (only if no laborers/users assigned)
    async delete(id) {
        try {
            // Check for assigned laborers
            const { count: laborerCount } = await supabaseClient
                .from('laborers')
                .select('*', { count: 'exact', head: true })
                .eq('department_id', id);

            if (laborerCount > 0) {
                return { success: false, error: 'Cannot delete: Department has laborers assigned' };
            }

            // Check for assigned users
            const { count: userCount } = await supabaseClient
                .from('users')
                .select('*', { count: 'exact', head: true })
                .eq('department_id', id);

            if (userCount > 0) {
                return { success: false, error: 'Cannot delete: Department has users assigned' };
            }

            // Get old value for audit
            const { data: oldData } = await supabaseClient
                .from('departments')
                .select('*')
                .eq('id', id)
                .single();

            const { error } = await supabaseClient
                .from('departments')
                .delete()
                .eq('id', id);

            if (error) throw error;

            // Audit log
            await AUTH.logAction('DELETE', 'departments', id, oldData, null);

            return { success: true };
        } catch (error) {
            console.error('Delete department error:', error);
            return { success: false, error: error.message };
        }
    }
};