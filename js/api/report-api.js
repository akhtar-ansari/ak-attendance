// AK Attendance - Report API
const ReportAPI = {
    // Get daily attendance summary
    async getDailyAttendance(fromDate, toDate, departmentId = null) {
        try {
            const departmentFilter = departmentId || AUTH.getDepartmentFilter();
            
            let query = supabaseClient
                .from('daily_attendance')
                .select(`
                    *,
                    laborers:labor_id (
                        labor_id,
                        name,
                        iqama_number,
                        nationality,
                        date_of_joining,
                        department_id
                    )
                `)
                .eq('client_id', AUTH.getClientId())
                .gte('date', fromDate)
                .lte('date', toDate)
                .order('date', { ascending: false });

            if (departmentFilter) {
                query = query.eq('department_id', departmentFilter);
            }

            const { data, error } = await query;

            if (error) throw error;
            return { success: true, data: data || [] };
        } catch (error) {
            console.error('Get daily attendance error:', error);
            return { success: false, error: error.message };
        }
    },

    // Get attendance for a specific laborer
    async getLaborerAttendance(laborId, fromDate, toDate) {
        try {
            const { data, error } = await supabaseClient
                .from('daily_attendance')
                .select('*')
                .eq('client_id', AUTH.getClientId())
                .eq('labor_id', laborId)
                .gte('date', fromDate)
                .lte('date', toDate)
                .order('date');

            if (error) throw error;
            return { success: true, data: data || [] };
        } catch (error) {
            console.error('Get laborer attendance error:', error);
            return { success: false, error: error.message };
        }
    },

    // Get punch photos for a specific date and laborer
    async getPunchPhotos(laborId, date) {
        try {
            const { data, error } = await supabaseClient
                .from('punch_records')
                .select('id, time, type, photo_url, confidence, location_name')
                .eq('client_id', AUTH.getClientId())
                .eq('labor_id', laborId)
                .eq('date', date)
                .order('time');

            if (error) throw error;
            return { success: true, data: data || [] };
        } catch (error) {
            console.error('Get punch photos error:', error);
            return { success: false, error: error.message };
        }
    },

    // Get monthly summary for 3PL billing
    async getMonthlyBilling(year, month, departmentId = null) {
        try {
            const departmentFilter = departmentId || AUTH.getDepartmentFilter();
            
            // Calculate date range
            const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
            const lastDay = new Date(year, month, 0).getDate();
            const endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;

            // Get all laborers for the department
            let laborQuery = supabaseClient
                .from('laborers')
                .select('labor_id, iqama_number, name, date_of_joining, department_id')
                .eq('client_id', AUTH.getClientId())
                .order('labor_id');

            if (departmentFilter) {
                laborQuery = laborQuery.eq('department_id', departmentFilter);
            }

            const { data: laborers, error: laborError } = await laborQuery;
            if (laborError) throw laborError;

            // Get all attendance records for the month
            let attendanceQuery = supabaseClient
                .from('daily_attendance')
                .select('labor_id, date, final_status')
                .eq('client_id', AUTH.getClientId())
                .gte('date', startDate)
                .lte('date', endDate);

            if (departmentFilter) {
                attendanceQuery = attendanceQuery.eq('department_id', departmentFilter);
            }

            const { data: attendance, error: attError } = await attendanceQuery;
            if (attError) throw attError;

            // Build attendance map
            const attendanceMap = {};
            (attendance || []).forEach(a => {
                const key = `${a.labor_id}_${a.date}`;
                attendanceMap[key] = a.final_status;
            });

            // Build report data
            const reportData = laborers.map(laborer => {
                const doj = new Date(laborer.date_of_joining);
                const days = {};
                let presentCount = 0;
                let halfDayCount = 0;
                let absentCount = 0;
                let fridayCount = 0;

                for (let day = 1; day <= lastDay; day++) {
                    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const dateObj = new Date(dateStr);
                    const isFriday = dateObj.getDay() === 5;
                    const isBeforeDOJ = dateObj < doj;

                    const key = `${laborer.labor_id}_${dateStr}`;
                    let status = attendanceMap[key] || null;

                    if (isFriday) {
                        if (isBeforeDOJ) {
                            status = 'A';
                            absentCount++;
                        } else {
                            // Sandwich rule: Thu Absent + Sat Absent = Fri Absent
                            const thursdayStr = `${year}-${String(month).padStart(2, '0')}-${String(day - 1).padStart(2, '0')}`;
                            const saturdayStr = `${year}-${String(month).padStart(2, '0')}-${String(day + 1).padStart(2, '0')}`;
                            
                            const thursdayKey = `${laborer.labor_id}_${thursdayStr}`;
                            const saturdayKey = `${laborer.labor_id}_${saturdayStr}`;
                            
                            const thursdayStatus = attendanceMap[thursdayKey] || 'A';
                            const saturdayStatus = day + 1 <= lastDay ? (attendanceMap[saturdayKey] || 'A') : 'A';
                            
                            if (thursdayStatus === 'A' && saturdayStatus === 'A') {
                                status = 'A';
                                absentCount++;
                            } else {
                                status = '-';
                                fridayCount++;
                            }
                        }
                    } else if (isBeforeDOJ) {
                        status = 'A';
                        absentCount++;
                    } else if (!status) {
                        status = 'A';
                        absentCount++;
                    } else if (status === 'P') {
                        presentCount++;
                    } else if (status === 'H') {
                        halfDayCount++;
                    } else if (status === 'A') {
                        absentCount++;
                    }

                    days[day] = status;
                }

                return {
                    laborId: laborer.labor_id,
                    iqamaNumber: laborer.iqama_number,
                    name: laborer.name,
                    dateOfJoining: laborer.date_of_joining,
                    days,
                    presentCount,
                    halfDayCount,
                    absentCount,
                    fridayCount,
                    totalWorkDays: presentCount + halfDayCount
                };
            });

            return { 
                success: true, 
                data: reportData,
                meta: {
                    year,
                    month,
                    totalDays: lastDay,
                    startDate,
                    endDate
                }
            };
        } catch (error) {
            console.error('Get monthly billing error:', error);
            return { success: false, error: error.message };
        }
    },

    // Get dashboard statistics
    async getDashboardStats(departmentId = null) {
        try {
            const departmentFilter = departmentId || AUTH.getDepartmentFilter();
            const today = DateUtils.today();

            // Get laborer counts
            let laborQuery = supabaseClient
                .from('laborers')
                .select('status, face_enrolled', { count: 'exact' })
                .eq('client_id', AUTH.getClientId());

            if (departmentFilter) {
                laborQuery = laborQuery.eq('department_id', departmentFilter);
            }

            const { data: laborers } = await laborQuery;

            const totalLaborers = laborers?.length || 0;
            const activeLaborers = laborers?.filter(l => l.status === 'active').length || 0;
            const faceEnrolled = laborers?.filter(l => l.face_enrolled).length || 0;

            // Get today's attendance
            let attendanceQuery = supabaseClient
                .from('daily_attendance')
                .select('final_status')
                .eq('client_id', AUTH.getClientId())
                .eq('date', today);

            if (departmentFilter) {
                attendanceQuery = attendanceQuery.eq('department_id', departmentFilter);
            }

            const { data: todayAttendance } = await attendanceQuery;

            const todayPresent = todayAttendance?.filter(a => a.final_status === 'P').length || 0;
            const todayHalfDay = todayAttendance?.filter(a => a.final_status === 'H').length || 0;
            const todayAbsent = todayAttendance?.filter(a => a.final_status === 'A').length || 0;

            // Get today's punches
            let punchQuery = supabaseClient
                .from('punch_records')
                .select('type')
                .eq('client_id', AUTH.getClientId())
                .eq('date', today);

            if (departmentFilter) {
                punchQuery = punchQuery.eq('department_id', departmentFilter);
            }

            const { data: todayPunches } = await punchQuery;

            const todayLogins = todayPunches?.filter(p => p.type === 'login').length || 0;
            const todayLogouts = todayPunches?.filter(p => p.type === 'logout').length || 0;

            // Get pending LOP count (H or A that can be approved)
            let lopQuery = supabaseClient
                .from('daily_attendance')
                .select('id', { count: 'exact', head: true })
                .eq('client_id', AUTH.getClientId())
                .in('auto_status', ['H', 'A'])
                .is('approved_by', null);

            if (departmentFilter) {
                lopQuery = lopQuery.eq('department_id', departmentFilter);
            }

            const { count: pendingLOP } = await lopQuery;

            return {
                success: true,
                data: {
                    totalLaborers,
                    activeLaborers,
                    faceEnrolled,
                    todayPresent,
                    todayHalfDay,
                    todayAbsent,
                    todayLogins,
                    todayLogouts,
                    currentlyWorking: Math.max(0, todayLogins - todayLogouts),
                    pendingLOP: pendingLOP || 0
                }
            };
        } catch (error) {
            console.error('Get dashboard stats error:', error);
            return { success: false, error: error.message };
        }
    },

    // ============ LOP APPROVAL FUNCTIONS ============

    // Check if date is within approval window (until 1st of next month)
    isDateApprovable(dateStr) {
        const recordDate = new Date(dateStr);
        const today = new Date();
        
        // Get 1st of next month
        const nextMonth1st = new Date(today.getFullYear(), today.getMonth() + 1, 1);
        nextMonth1st.setHours(23, 59, 59, 999); // End of day
        
        // Record date must be before 1st of next month
        return recordDate <= nextMonth1st;
    },

    // Approve single LOP (Admin + Supervisor)
    async approveLOP(recordId, reason) {
        try {
            const session = AUTH.getSession();
            if (!session) {
                return { success: false, error: 'Not authenticated' };
            }

            // Get the record first
            const { data: record, error: fetchError } = await supabaseClient
                .from('daily_attendance')
                .select('*')
                .eq('id', recordId)
                .eq('client_id', AUTH.getClientId())
                .single();

            if (fetchError || !record) {
                return { success: false, error: 'Record not found' };
            }

            // Check if already approved
            if (record.final_status === 'P' && record.approved_by) {
                return { success: false, error: 'Already approved' };
            }

            // Check if approvable (H or A only)
            if (record.auto_status !== 'H' && record.auto_status !== 'A') {
                return { success: false, error: 'Only Half Day or Absent can be approved' };
            }

            // Check date window
            if (!this.isDateApprovable(record.date)) {
                return { success: false, error: 'Approval period has ended for this date' };
            }

            // Update record
            const { error: updateError } = await supabaseClient
                .from('daily_attendance')
                .update({
                    final_status: 'P',
                    approved_by: session.name,
                    approved_at: new Date().toISOString(),
                    lop_reason: reason,
                    updated_at: new Date().toISOString()
                })
                .eq('id', recordId)
                .eq('client_id', AUTH.getClientId());

            if (updateError) throw updateError;

            // Log action
            await AUTH.logAction('lop_approve', `Approved ${record.labor_id} on ${record.date}: ${record.auto_status} → P`);

            return { success: true };
        } catch (error) {
            console.error('Approve LOP error:', error);
            return { success: false, error: error.message };
        }
    },

    // Bulk approve LOP (Admin only)
    async bulkApproveLOP(recordIds, reason) {
        try {
            const session = AUTH.getSession();
            if (!session) {
                return { success: false, error: 'Not authenticated' };
            }

            // Check admin role
            if (session.role !== 'super_admin' && session.role !== 'admin') {
                return { success: false, error: 'Bulk approval requires Admin access' };
            }

            if (!recordIds || recordIds.length === 0) {
                return { success: false, error: 'No records selected' };
            }

            // Get all records
            const { data: records, error: fetchError } = await supabaseClient
                .from('daily_attendance')
                .select('*')
                .in('id', recordIds)
                .eq('client_id', AUTH.getClientId());

            if (fetchError) throw fetchError;

            // Filter valid records
            const validRecords = records.filter(r => {
                const isApprovableStatus = (r.auto_status === 'H' || r.auto_status === 'A');
                const notAlreadyApproved = !(r.final_status === 'P' && r.approved_by);
                const withinWindow = this.isDateApprovable(r.date);
                return isApprovableStatus && notAlreadyApproved && withinWindow;
            });

            if (validRecords.length === 0) {
                return { success: false, error: 'No valid records to approve' };
            }

            const validIds = validRecords.map(r => r.id);

            // Update all valid records
            const { error: updateError } = await supabaseClient
                .from('daily_attendance')
                .update({
                    final_status: 'P',
                    approved_by: session.name,
                    approved_at: new Date().toISOString(),
                    lop_reason: reason,
                    updated_at: new Date().toISOString()
                })
                .in('id', validIds)
                .eq('client_id', AUTH.getClientId());

            if (updateError) throw updateError;

            // Log action
            await AUTH.logAction('lop_bulk_approve', `Bulk approved ${validRecords.length} records`);

            return { 
                success: true, 
                approvedCount: validRecords.length,
                skippedCount: recordIds.length - validRecords.length
            };
        } catch (error) {
            console.error('Bulk approve LOP error:', error);
            return { success: false, error: error.message };
        }
    },

    // Undo LOP approval (Admin only)
    async undoLOP(recordId) {
        try {
            const session = AUTH.getSession();
            if (!session) {
                return { success: false, error: 'Not authenticated' };
            }

            // Check admin role
            if (session.role !== 'super_admin' && session.role !== 'admin') {
                return { success: false, error: 'Undo requires Admin access' };
            }

            // Get the record
            const { data: record, error: fetchError } = await supabaseClient
                .from('daily_attendance')
                .select('*')
                .eq('id', recordId)
                .eq('client_id', AUTH.getClientId())
                .single();

            if (fetchError || !record) {
                return { success: false, error: 'Record not found' };
            }

            // Check if was approved
            if (!record.approved_by) {
                return { success: false, error: 'Record was not approved' };
            }

            // Check date window
            if (!this.isDateApprovable(record.date)) {
                return { success: false, error: 'Undo period has ended for this date' };
            }

            // Revert to auto_status
            const { error: updateError } = await supabaseClient
                .from('daily_attendance')
                .update({
                    final_status: record.auto_status,
                    approved_by: null,
                    approved_at: null,
                    lop_reason: null,
                    updated_at: new Date().toISOString()
                })
                .eq('id', recordId)
                .eq('client_id', AUTH.getClientId());

            if (updateError) throw updateError;

            // Log action
            await AUTH.logAction('lop_undo', `Undid approval for ${record.labor_id} on ${record.date}: P → ${record.auto_status}`);

            return { success: true };
        } catch (error) {
            console.error('Undo LOP error:', error);
            return { success: false, error: error.message };
        }
    }

};
