// AK Attendance - Report API v2 (with In/Out times for 3PL Billing)
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

    // Format time for display (HH:MM AM/PM)
    formatTime12h(timeStr) {
        if (!timeStr) return '';
        try {
            const [hours, minutes] = timeStr.split(':');
            const h = parseInt(hours);
            const ampm = h >= 12 ? 'PM' : 'AM';
            const h12 = h % 12 || 12;
            return `${h12}:${minutes} ${ampm}`;
        } catch {
            return '';
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
                .eq('client_id', AUTH.getClientId());

            if (departmentFilter) {
                laborQuery = laborQuery.eq('department_id', departmentFilter);
            }

            const { data: laborers, error: laborError } = await laborQuery;
            if (laborError) throw laborError;

            // Natural sort by labor_id (L1, L2, L3... not L1, L10, L11)
            laborers.sort((a, b) => {
                const aNum = parseInt(a.labor_id.replace(/\D/g, '')) || 0;
                const bNum = parseInt(b.labor_id.replace(/\D/g, '')) || 0;
                return aNum - bNum;
            });

            // Get all attendance records for the month (including first_login, last_logout)
            let attendanceQuery = supabaseClient
                .from('daily_attendance')
                .select('labor_id, date, final_status, first_login, last_logout')
                .eq('client_id', AUTH.getClientId())
                .gte('date', startDate)
                .lte('date', endDate);

            if (departmentFilter) {
                attendanceQuery = attendanceQuery.eq('department_id', departmentFilter);
            }

            const { data: attendance, error: attError } = await attendanceQuery;
            if (attError) throw attError;

            // Build attendance map with in/out times
            const attendanceMap = {};
            (attendance || []).forEach(a => {
                const key = `${a.labor_id}_${a.date}`;
                attendanceMap[key] = {
                    status: a.final_status,
                    firstIn: a.first_login,
                    lastOut: a.last_logout
                };
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
                    const record = attendanceMap[key] || null;
                    let status = record ? record.status : null;
                    let firstIn = record ? record.firstIn : null;
                    let lastOut = record ? record.lastOut : null;

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
                            
                            const thursdayRecord = attendanceMap[thursdayKey];
                            const saturdayRecord = attendanceMap[saturdayKey];
                            
                            const thursdayStatus = thursdayRecord ? thursdayRecord.status : 'A';
                            const saturdayStatus = day + 1 <= lastDay ? (saturdayRecord ? saturdayRecord.status : 'A') : 'A';
                            
                            if (thursdayStatus === 'A' && saturdayStatus === 'A') {
                                status = 'A';
                                absentCount++;
                            } else {
                                status = 'F';
                                fridayCount++;
                            }
                        }
                        // Clear in/out for Friday
                        firstIn = null;
                        lastOut = null;
                    } else if (isBeforeDOJ) {
                        status = 'A';
                        absentCount++;
                        firstIn = null;
                        lastOut = null;
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

                    days[day] = {
                        status: status,
                        in: this.formatTime12h(firstIn),
                        out: this.formatTime12h(lastOut)
                    };
                }

                // Calculate total paid days: P*1 + F*1 + H*0.5
                const totalPaidDays = presentCount + fridayCount + (halfDayCount * 0.5);

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
                    totalPaidDays
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

            // Get pending LOP count from daily_attendance (H or A without approved_by)
            let lopQuery = supabaseClient
                .from('daily_attendance')
                .select('id', { count: 'exact', head: true })
                .eq('client_id', AUTH.getClientId())
                .in('final_status', ['H', 'A'])
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

    // Approve LOP (single)
    async approveLOP(attendanceId, reason) {
        try {
            const session = AUTH.getSession();
            
            const { error } = await supabaseClient
                .from('daily_attendance')
                .update({
                    final_status: 'P',
                    approved_by: session.name,
                    approved_at: new Date().toISOString(),
                    lop_reason: reason
                })
                .eq('id', attendanceId)
                .eq('client_id', AUTH.getClientId());

            if (error) throw error;
            return { success: true };
        } catch (error) {
            console.error('Approve LOP error:', error);
            return { success: false, error: error.message };
        }
    },

    // Bulk approve LOP (admin only)
    async bulkApproveLOP(attendanceIds, reason) {
        try {
            if (!AUTH.hasRole('admin')) {
                return { success: false, error: 'Only admin can bulk approve' };
            }

            const session = AUTH.getSession();
            
            const { error } = await supabaseClient
                .from('daily_attendance')
                .update({
                    final_status: 'P',
                    approved_by: session.name,
                    approved_at: new Date().toISOString(),
                    lop_reason: reason
                })
                .in('id', attendanceIds)
                .eq('client_id', AUTH.getClientId());

            if (error) throw error;
            return { success: true };
        } catch (error) {
            console.error('Bulk approve LOP error:', error);
            return { success: false, error: error.message };
        }
    },

    // Undo LOP approval (admin only)
    async undoLOP(attendanceId, originalStatus) {
        try {
            if (!AUTH.hasRole('admin')) {
                return { success: false, error: 'Only admin can undo approval' };
            }

            const { error } = await supabaseClient
                .from('daily_attendance')
                .update({
                    final_status: originalStatus,
                    approved_by: null,
                    approved_at: null,
                    lop_reason: null
                })
                .eq('id', attendanceId)
                .eq('client_id', AUTH.getClientId());

            if (error) throw error;
            return { success: true };
        } catch (error) {
            console.error('Undo LOP error:', error);
            return { success: false, error: error.message };
        }
    },

    // Check if date is still approvable (before 1st of next month)
    isDateApprovable(dateStr) {
        const date = new Date(dateStr);
        const now = new Date();
        
        // Get 1st of next month after the date
        const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1);
        
        return now < nextMonth;
    }
};
