// AK Attendance - Labor API
const LaborAPI = {
    // Get all laborers (filtered by department for non-super-admin)
    async getAll() {
        try {
            const departmentFilter = AUTH.getDepartmentFilter();
            
            let query = supabase
                .from('laborers')
                .select(`
                    *,
                    departments:department_id (id, name, code)
                `)
                .order('labor_id');

            if (departmentFilter) {
                query = query.eq('department_id', departmentFilter);
            }

            const { data, error } = await query;

            if (error) throw error;
            return { success: true, data: data || [] };
        } catch (error) {
            console.error('Get laborers error:', error);
            return { success: false, error: error.message };
        }
    },

    // Get active laborers only
    async getActive() {
        try {
            const departmentFilter = AUTH.getDepartmentFilter();
            
            let query = supabase
                .from('laborers')
                .select(`
                    *,
                    departments:department_id (id, name, code)
                `)
                .eq('status', 'active')
                .order('labor_id');

            if (departmentFilter) {
                query = query.eq('department_id', departmentFilter);
            }

            const { data, error } = await query;

            if (error) throw error;
            return { success: true, data: data || [] };
        } catch (error) {
            console.error('Get active laborers error:', error);
            return { success: false, error: error.message };
        }
    },

    // Get single laborer by Labor ID (e.g., L1, L25)
    async getByLaborId(laborId) {
        try {
            const { data, error } = await supabase
                .from('laborers')
                .select(`
                    *,
                    departments:department_id (id, name, code)
                `)
                .eq('labor_id', laborId)
                .single();

            if (error) throw error;
            return { success: true, data };
        } catch (error) {
            console.error('Get laborer error:', error);
            return { success: false, error: error.message };
        }
    },

    // Get laborer by Iqama number
    async getByIqama(iqamaNumber) {
        try {
            const { data, error } = await supabase
                .from('laborers')
                .select(`
                    *,
                    departments:department_id (id, name, code)
                `)
                .eq('iqama_number', iqamaNumber)
                .single();

            if (error && error.code !== 'PGRST116') throw error;
            return { success: true, data: data || null };
        } catch (error) {
            console.error('Get laborer by iqama error:', error);
            return { success: false, error: error.message };
        }
    },

    // Check if Iqama exists (for duplicate prevention)
    async iqamaExists(iqamaNumber) {
        try {
            const { count, error } = await supabase
                .from('laborers')
                .select('*', { count: 'exact', head: true })
                .eq('iqama_number', iqamaNumber);

            if (error) throw error;
            return { success: true, exists: count > 0 };
        } catch (error) {
            console.error('Check iqama error:', error);
            return { success: false, error: error.message };
        }
    },

    // Register Iqama and get Labor ID (from iqama_registry)
    async registerIqama(iqamaNumber) {
        try {
            const { data, error } = await supabase
                .rpc('register_iqama', { p_iqama: iqamaNumber });

            if (error) throw error;
            return { success: true, laborId: data };
        } catch (error) {
            console.error('Register iqama error:', error);
            return { success: false, error: error.message };
        }
    },

    // Create new laborer
    async create(laborer) {
        try {
            // Check if Iqama already exists in laborers table
            const existsCheck = await this.iqamaExists(laborer.iqamaNumber);
            if (existsCheck.exists) {
                return { success: false, error: 'Iqama number already exists' };
            }

            // Register Iqama and get Labor ID
            const iqamaResult = await this.registerIqama(laborer.iqamaNumber);
            if (!iqamaResult.success) {
                return { success: false, error: iqamaResult.error };
            }

            const laborId = iqamaResult.laborId;

            // Insert laborer
            const { data, error } = await supabase
                .from('laborers')
                .insert({
                    labor_id: laborId,
                    iqama_number: laborer.iqamaNumber,
                    name: laborer.name.trim(),
                    nationality: laborer.nationality.trim(),
                    date_of_joining: laborer.dateOfJoining,
                    department_id: laborer.departmentId,
                    status: laborer.status || 'active',
                    face_enrolled: false,
                    needs_reenrollment: false,
                    low_confidence_count: 0
                })
                .select(`
                    *,
                    departments:department_id (id, name, code)
                `)
                .single();

            if (error) throw error;

            // Audit log
            await AUTH.logAction('CREATE', 'laborers', data.id, null, data);

            return { success: true, data };
        } catch (error) {
            console.error('Create laborer error:', error);
            return { success: false, error: error.message };
        }
    },

    // Update laborer
    async update(laborId, updates) {
        try {
            // Get old value for audit
            const { data: oldData } = await supabase
                .from('laborers')
                .select('*')
                .eq('labor_id', laborId)
                .single();

            const updateObj = {};
            if (updates.name) updateObj.name = updates.name.trim();
            if (updates.nationality) updateObj.nationality = updates.nationality.trim();
            if (updates.dateOfJoining) updateObj.date_of_joining = updates.dateOfJoining;
            if (updates.departmentId) updateObj.department_id = updates.departmentId;
            if (updates.status) updateObj.status = updates.status;
            if (updates.faceEnrolled !== undefined) updateObj.face_enrolled = updates.faceEnrolled;
            if (updates.faceDescriptor !== undefined) updateObj.face_descriptor = updates.faceDescriptor;
            if (updates.enrollmentDate) updateObj.enrollment_date = updates.enrollmentDate;
            if (updates.needsReenrollment !== undefined) updateObj.needs_reenrollment = updates.needsReenrollment;
            if (updates.lowConfidenceCount !== undefined) updateObj.low_confidence_count = updates.lowConfidenceCount;
            if (updates.lastLowConfidenceDate) updateObj.last_low_confidence_date = updates.lastLowConfidenceDate;

            const { data, error } = await supabase
                .from('laborers')
                .update(updateObj)
                .eq('labor_id', laborId)
                .select(`
                    *,
                    departments:department_id (id, name, code)
                `)
                .single();

            if (error) throw error;

            // Audit log
            await AUTH.logAction('UPDATE', 'laborers', data.id, oldData, data);

            return { success: true, data };
        } catch (error) {
            console.error('Update laborer error:', error);
            return { success: false, error: error.message };
        }
    },

    // Delete laborer (soft delete - set status inactive, or hard delete)
    async delete(laborId, hardDelete = false) {
        try {
            // Get old value for audit
            const { data: oldData } = await supabase
                .from('laborers')
                .select('*')
                .eq('labor_id', laborId)
                .single();

            if (hardDelete) {
                const { error } = await supabase
                    .from('laborers')
                    .delete()
                    .eq('labor_id', laborId);

                if (error) throw error;
            } else {
                const { error } = await supabase
                    .from('laborers')
                    .update({ status: 'inactive' })
                    .eq('labor_id', laborId);

                if (error) throw error;
            }

            // Audit log
            await AUTH.logAction('DELETE', 'laborers', oldData.id, oldData, null);

            return { success: true };
        } catch (error) {
            console.error('Delete laborer error:', error);
            return { success: false, error: error.message };
        }
    },

    // Bulk import laborers from CSV
    async bulkImport(laborers) {
        const results = { success: 0, failed: 0, errors: [] };

        for (const laborer of laborers) {
            const result = await this.create(laborer);
            if (result.success) {
                results.success++;
            } else {
                results.failed++;
                results.errors.push({
                    iqama: laborer.iqamaNumber,
                    error: result.error
                });
            }
        }

        return results;
    },

    // Get laborers needing re-enrollment
    async getNeedingReenrollment() {
        try {
            const departmentFilter = AUTH.getDepartmentFilter();
            
            let query = supabase
                .from('laborers')
                .select(`
                    *,
                    departments:department_id (id, name, code)
                `)
                .eq('needs_reenrollment', true)
                .eq('status', 'active');

            if (departmentFilter) {
                query = query.eq('department_id', departmentFilter);
            }

            const { data, error } = await query;

            if (error) throw error;
            return { success: true, data: data || [] };
        } catch (error) {
            console.error('Get needing reenrollment error:', error);
            return { success: false, error: error.message };
        }
    },

    // Update face enrollment
    async updateFaceEnrollment(laborId, faceDescriptor) {
        try {
            const { data, error } = await supabase
                .from('laborers')
                .update({
                    face_enrolled: true,
                    face_descriptor: faceDescriptor,
                    enrollment_date: new Date().toISOString(),
                    needs_reenrollment: false,
                    low_confidence_count: 0
                })
                .eq('labor_id', laborId)
                .select()
                .single();

            if (error) throw error;

            // Audit log
            await AUTH.logAction('FACE_ENROLL', 'laborers', data.id, null, { labor_id: laborId });

            return { success: true, data };
        } catch (error) {
            console.error('Update face enrollment error:', error);
            return { success: false, error: error.message };
        }
    },

    // Increment low confidence count (for re-enrollment flagging)
    async incrementLowConfidence(laborId) {
        try {
            const { data: laborer } = await supabase
                .from('laborers')
                .select('low_confidence_count, last_low_confidence_date')
                .eq('labor_id', laborId)
                .single();

            const today = new Date().toISOString().split('T')[0];
            const lastDate = laborer.last_low_confidence_date;
            
            // Reset count if last low confidence was more than 7 days ago
            let newCount = laborer.low_confidence_count + 1;
            if (lastDate) {
                const daysDiff = Math.floor((new Date(today) - new Date(lastDate)) / (1000 * 60 * 60 * 24));
                if (daysDiff > 7) {
                    newCount = 1;
                }
            }

            // Flag for re-enrollment if count >= 3
            const needsReenrollment = newCount >= 3;

            const { error } = await supabase
                .from('laborers')
                .update({
                    low_confidence_count: newCount,
                    last_low_confidence_date: today,
                    needs_reenrollment: needsReenrollment
                })
                .eq('labor_id', laborId);

            if (error) throw error;

            return { success: true, needsReenrollment };
        } catch (error) {
            console.error('Increment low confidence error:', error);
            return { success: false, error: error.message };
        }
    }
};