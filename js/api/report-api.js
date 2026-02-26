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
                .select('status, face_enrolled', { count: 'exact' });

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
                .eq('date', today);

            if (departmentFilter) {
                punchQuery = punchQuery.eq('department_id', departmentFilter);
            }

            const { data: todayPunches } = await punchQuery;

            const todayLogins = todayPunches?.filter(p => p.type === 'login').length || 0;
            const todayLogouts = todayPunches?.filter(p => p.type === 'logout').length || 0;

            // Get pending LOP requests
            let lopQuery = supabaseClient
                .from('lop_requests')
                .select('id', { count: 'exact', head: true })
                .eq('approval_status', 'pending');

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
    }

};

