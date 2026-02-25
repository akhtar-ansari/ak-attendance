// AK Attendance - LOP API
const LOPAPI = {
    // Get all LOP requests (filtered by department and status)
    async getAll(status = null) {
        try {
            const departmentFilter = AUTH.getDepartmentFilter();
            
            let query = supabase
                .from('lop_requests')
                .select(`
                    *,
                    laborers:labor_id (labor_id, name, iqama_number),
                    requester:requested_by (name),
                    approver:approved_by (name)
                `)
                .order('created_at', { ascending: false });

            if (departmentFilter) {
                query = query.eq('department_id', departmentFilter);
            }

            if (status) {
                query = query.eq('approval_status', status);
            }

            const { data, error } = await query;

            if (error) throw error;
            return { success: true, data: data || [] };
        } catch (error) {
            console.error('Get LOP requests error:', error);
            return { success: false, error: error.message };
        }
    },

    // Get pending LOP requests
    async getPending() {
        return this.getAll('pending');
    },

    // Get LOP requests for a specific laborer
    async getByLaborer(laborId) {
        try {
            const { data, error } = await supabase
                .from('lop_requests')
                .select(`
                    *,
                    requester:requested_by (name),
                    approver:approved_by (name)
                `)
                .eq('labor_id', laborId)
                .order('date', { ascending: false });

            if (error) throw error;
            return { success: true, data: data || [] };
        } catch (error) {
            console.error('Get laborer LOP error:', error);
            return { success: false, error: error.message };
        }
    },

    // Create LOP request
    async create(request) {
        try {
            const session = AUTH.getSession();

            // Check if request already exists for this date
            const { data: existing } = await supabase
                .from('lop_requests')
                .select('id')
                .eq('labor_id', request.laborId)
                .eq('date', request.date)
                .single();

            if (existing) {
                return { success: false, error: 'LOP request already exists for this date' };
            }

            const { data, error } = await supabase
                .from('lop_requests')
                .insert({
                    labor_id: request.laborId,
                    department_id: request.departmentId,
                    date: request.date,
                    auto_status: request.autoStatus,
                    requested_status: request.requestedStatus,
                    remarks: request.remarks,
                    requested_by: session.userId,
                    approval_status: 'pending'
                })
                .select()
                .single();

            if (error) throw error;

            await AUTH.logAction('CREATE', 'lop_requests', data.id, null, data);

            return { success: true, data };
        } catch (error) {
            console.error('Create LOP request error:', error);
            return { success: false, error: error.message };
        }
    },

    // Approve single LOP request
    async approve(requestId, approvedStatus = null) {
        try {
            const session = AUTH.getSession();

            // Get current request
            const { data: current } = await supabase
                .from('lop_requests')
                .select('*')
                .eq('id', requestId)
                .single();

            if (!current) {
                return { success: false, error: 'Request not found' };
            }

            const finalStatus = approvedStatus || current.requested_status;

            // Update LOP request
            const { data, error } = await supabase
                .from('lop_requests')
                .update({
                    approval_status: 'approved',
                    approved_by: session.userId,
                    approved_at: new Date().toISOString()
                })
                .eq('id', requestId)
                .select()
                .single();

            if (error) throw error;

            // Update daily attendance final_status
            await supabase
                .from('daily_attendance')
                .update({
                    final_status: finalStatus,
                    lop_request_id: requestId
                })
                .eq('labor_id', current.labor_id)
                .eq('date', current.date);

            await AUTH.logAction('APPROVE', 'lop_requests', requestId, current, data);

            return { success: true, data };
        } catch (error) {
            console.error('Approve LOP error:', error);
            return { success: false, error: error.message };
        }
    },

    // Reject LOP request
    async reject(requestId, reason = null) {
        try {
            const session = AUTH.getSession();

            const { data: current } = await supabase
                .from('lop_requests')
                .select('*')
                .eq('id', requestId)
                .single();

            const { data, error } = await supabase
                .from('lop_requests')
                .update({
                    approval_status: 'rejected',
                    rejection_reason: reason,
                    approved_by: session.userId,
                    approved_at: new Date().toISOString()
                })
                .eq('id', requestId)
                .select()
                .single();

            if (error) throw error;

            await AUTH.logAction('REJECT', 'lop_requests', requestId, current, data);

            return { success: true, data };
        } catch (error) {
            console.error('Reject LOP error:', error);
            return { success: false, error: error.message };
        }
    },

    // Bulk approve multiple LOP requests
    async bulkApprove(requestIds) {
        const results = { success: 0, failed: 0, errors: [] };

        for (const id of requestIds) {
            const result = await this.approve(id);
            if (result.success) {
                results.success++;
            } else {
                results.failed++;
                results.errors.push({ id, error: result.error });
            }
        }

        return results;
    },

    // Bulk reject multiple LOP requests
    async bulkReject(requestIds, reason = null) {
        const results = { success: 0, failed: 0, errors: [] };

        for (const id of requestIds) {
            const result = await this.reject(id, reason);
            if (result.success) {
                results.success++;
            } else {
                results.failed++;
                results.errors.push({ id, error: result.error });
            }
        }

        return results;
    },

    // Auto-create LOP requests for attendance anomalies
    async autoCreateForDate(date, departmentId = null) {
        try {
            const departmentFilter = departmentId || AUTH.getDepartmentFilter();

            // Get daily attendance records with H or A status
            let query = supabase
                .from('daily_attendance')
                .select('labor_id, department_id, date, auto_status')
                .eq('date', date)
                .in('auto_status', ['H', 'A']);

            if (departmentFilter) {
                query = query.eq('department_id', departmentFilter);
            }

            const { data: records, error } = await query;

            if (error) throw error;

            let created = 0;
            for (const record of records || []) {
                // Check if LOP request already exists
                const { data: existing } = await supabase
                    .from('lop_requests')
                    .select('id')
                    .eq('labor_id', record.labor_id)
                    .eq('date', record.date)
                    .single();

                if (!existing) {
                    await supabase
                        .from('lop_requests')
                        .insert({
                            labor_id: record.labor_id,
                            department_id: record.department_id,
                            date: record.date,
                            auto_status: record.auto_status,
                            requested_status: record.auto_status === 'H' ? 'P' : 'H',
                            remarks: 'Auto-generated',
                            approval_status: 'pending'
                        });
                    created++;
                }
            }

            return { success: true, created };
        } catch (error) {
            console.error('Auto-create LOP error:', error);
            return { success: false, error: error.message };
        }
    }
};