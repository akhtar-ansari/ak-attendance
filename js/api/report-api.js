// AK Attendance - Report API v5 (with Punch Location)
const ReportAPI = {
    // Get daily attendance summary (original - only punched laborers)
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

    // Get COMPLETE attendance - ALL active laborers (punched + non-punched)
    async getCompleteAttendance(fromDate, toDate, departmentId = null) {
        try {
            const departmentFilter = departmentId || AUTH.getDepartmentFilter();
            const clientId = AUTH.getClientId();

            // 1. Get all active laborers
            let laborQuery = supabaseClient
                .from('laborers')
                .select('labor_id, name, iqama_number, department_id, date_of_joining, status, role')
                .eq('client_id', clientId)
                .eq('status', 'active');

            if (departmentFilter) {
                laborQuery = laborQuery.eq('department_id', departmentFilter);
            }

            const { data: laborers, error: laborError } = await laborQuery;
            if (laborError) throw laborError;

            // 2. Get all attendance records for date range
            let attendanceQuery = supabaseClient
                .from('daily_attendance')
                .select('*')
                .eq('client_id', clientId)
                .gte('date', fromDate)
                .lte('date', toDate);

            if (departmentFilter) {
                attendanceQuery = attendanceQuery.eq('department_id', departmentFilter);
            }

            const { data: attendance, error: attError } = await attendanceQuery;
            if (attError) throw attError;

            // 2b. Get first punch location for each labor+date
            let punchQuery = supabaseClient
                .from('punch_records')
                .select('labor_id, date, time, location_name')
                .eq('client_id', clientId)
                .gte('date', fromDate)
                .lte('date', toDate)
                .order('time', { ascending: true });

            if (departmentFilter) {
                punchQuery = punchQuery.eq('department_id', departmentFilter);
            }

            const { data: punches, error: punchError } = await punchQuery;
            if (punchError) throw punchError;

            // Build first punch location map (first punch per labor+date)
            const punchLocationMap = {};
            (punches || []).forEach(p => {
                const key = `${p.labor_id}_${p.date}`;
                if (!punchLocationMap[key]) {
                    punchLocationMap[key] = p.location_name || '';
                }
            });

            // 3. Get departments for names
            const { data: departments } = await supabaseClient
                .from('departments')
                .select('id, name')
                .eq('client_id', clientId);

            const deptMap = {};
            (departments || []).forEach(d => deptMap[d.id] = d.name);

            // 4. Build attendance map
            const attendanceMap = {};
            (attendance || []).forEach(a => {
                const key = `${a.labor_id}_${a.date}`;
                attendanceMap[key] = a;
            });

            // 5. Generate all date + labor combinations
            const result = [];
            const startDate = new Date(fromDate);
            const endDate = new Date(toDate);

            for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
                const dateStr = d.toISOString().split('T')[0];
                const dayOfWeek = d.getDay(); // 0=Sun, 5=Fri

                for (const labor of laborers) {
                    const key = `${labor.labor_id}_${dateStr}`;
                    const record = attendanceMap[key];

                    // Skip if labor joined after this date
                    if (labor.date_of_joining && new Date(labor.date_of_joining) > d) {
                        continue;
                    }

                    if (record) {
                        // Has attendance record
                        result.push({
                            ...record,
                            laborName: labor.name,
                            role: labor.role || 'Labor',
                            iqamaNumber: labor.iqama_number,
                            departmentName: deptMap[labor.department_id] || '-',
                            punchLocation: punchLocationMap[key] || '',
                            hasRecord: true,
                            isFriday: dayOfWeek === 5
                        });
                    } else {
                        // No attendance record - create virtual absent record
                        result.push({
                            id: null, // No DB record
                            labor_id: labor.labor_id,
                            department_id: labor.department_id,
                            date: dateStr,
                            first_login: null,
                            last_logout: null,
                            total_hours: null,
                            auto_status: dayOfWeek === 5 ? 'F' : 'A',
                            final_status: dayOfWeek === 5 ? 'F' : 'A',
                            approved_by: null,
                            approved_at: null,
                            lop_reason: null,
                            client_id: clientId,
                            laborName: labor.name,
                            role: labor.role || 'Labor',
                            iqamaNumber: labor.iqama_number,
                            departmentName: deptMap[labor.department_id] || '-',
                            punchLocation: '',
                            hasRecord: false,
                            isFriday: dayOfWeek === 5
                        });
                    }
                }
            }

            // Sort by date desc, then labor_id
            result.sort((a, b) => {
                if (a.date !== b.date) {
                    return new Date(b.date) - new Date(a.date);
                }
                const aNum = parseInt(a.labor_id.replace(/\D/g, '')) || 0;
                const bNum = parseInt(b.labor_id.replace(/\D/g, '')) || 0;
                return aNum - bNum;
            });

            return { success: true, data: result };
        } catch (error) {
            console.error('Get complete attendance error:', error);
            return { success: false, error: error.message };
        }
    },

    // Create absent record and approve LOP (for laborers who didn't punch)
    async createAbsentAndApprove(laborId, date, departmentId, reason) {
        try {
            const session = AUTH.getSession();
            const clientId = AUTH.getClientId();

            // Check if record already exists
            const { data: existing } = await supabaseClient
                .from('daily_attendance')
                .select('id')
                .eq('client_id', clientId)
                .eq('labor_id', laborId)
                .eq('date', date)
                .single();

            if (existing) {
                // Record exists, just update it
                const { error } = await supabaseClient
                    .from('daily_attendance')
                    .update({
                        final_status: 'P',
                        approved_by: session.name,
                        approved_at: new Date().toISOString(),
                        lop_reason: reason
                    })
                    .eq('id', existing.id);

                if (error) throw error;
                return { success: true, recordId: existing.id };
            }

            // Create new record
            const { data: newRecord, error: insertError } = await supabaseClient
                .from('daily_attendance')
                .insert({
                    labor_id: laborId,
                    department_id: departmentId,
                    date: date,
                    first_login: null,
                    last_logout: null,
                    total_hours: 0,
                    auto_status: 'A',
                    final_status: 'P',
                    approved_by: session.name,
                    approved_at: new Date().toISOString(),
                    lop_reason: reason,
                    client_id: clientId
                })
                .select()
                .single();

            if (insertError) throw insertError;
            return { success: true, recordId: newRecord.id };
        } catch (error) {
            console.error('Create absent and approve error:', error);
            return { success: false, error: error.message };
        }
    },

    // Get absent streak for a labor (consecutive absent days)
    async getAbsentStreak(laborId) {
        try {
            const clientId = AUTH.getClientId();
            const today = new Date();
            const todayStr = today.toISOString().split('T')[0];
            
            // Look back 30 days max
            const thirtyDaysAgo = new Date(today);
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

            // Get attendance records for last 30 days
            const { data: attendance, error } = await supabaseClient
                .from('daily_attendance')
                .select('date, final_status')
                .eq('client_id', clientId)
                .eq('labor_id', laborId)
                .gte('date', thirtyDaysAgoStr)
                .lte('date', todayStr)
                .order('date', { ascending: false });

            if (error) throw error;

            // Build date map
            const attendanceMap = {};
            (attendance || []).forEach(a => {
                attendanceMap[a.date] = a.final_status;
            });

            // Count consecutive absent days from today backwards
            let streak = 0;
            for (let d = new Date(today); d >= thirtyDaysAgo; d.setDate(d.getDate() - 1)) {
                const dateStr = d.toISOString().split('T')[0];
                const dayOfWeek = d.getDay();
                
                // Skip Fridays
                if (dayOfWeek === 5) continue;

                const status = attendanceMap[dateStr];
                
                // If no record or status is A, count as absent
                if (!status || status === 'A') {
                    streak++;
                } else {
                    // Found a non-absent day, stop counting
                    break;
                }
            }

            return { success: true, streak };
        } catch (error) {
            console.error('Get absent streak error:', error);
            return { success: false, streak: 0, error: error.message };
        }
    },

    // Get absent streaks for all active laborers (for Labor Master badge)
    async getAllAbsentStreaks(departmentId = null) {
        try {
            const clientId = AUTH.getClientId();
            const departmentFilter = departmentId || AUTH.getDepartmentFilter();
            const today = new Date();
            const todayStr = today.toISOString().split('T')[0];
            
            // Look back 30 days
            const thirtyDaysAgo = new Date(today);
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

            // Get all active laborers
            let laborQuery = supabaseClient
                .from('laborers')
                .select('labor_id, date_of_joining')
                .eq('client_id', clientId)
                .eq('status', 'active');

            if (departmentFilter) {
                laborQuery = laborQuery.eq('department_id', departmentFilter);
            }

            const { data: laborers, error: laborError } = await laborQuery;
            if (laborError) throw laborError;

            // Get all attendance for last 30 days
            let attendanceQuery = supabaseClient
                .from('daily_attendance')
                .select('labor_id, date, final_status')
                .eq('client_id', clientId)
                .gte('date', thirtyDaysAgoStr)
                .lte('date', todayStr);

            if (departmentFilter) {
                attendanceQuery = attendanceQuery.eq('department_id', departmentFilter);
            }

            const { data: attendance, error: attError } = await attendanceQuery;
            if (attError) throw attError;

            // Build attendance map by labor
            const attendanceByLabor = {};
            (attendance || []).forEach(a => {
                if (!attendanceByLabor[a.labor_id]) {
                    attendanceByLabor[a.labor_id] = {};
                }
                attendanceByLabor[a.labor_id][a.date] = a.final_status;
            });

            // Calculate streak for each labor
            const streaks = {};
            for (const labor of laborers) {
                const laborAttendance = attendanceByLabor[labor.labor_id] || {};
                let streak = 0;
                const doj = labor.date_of_joining ? new Date(labor.date_of_joining) : null;

                for (let d = new Date(today); d >= thirtyDaysAgo; d.setDate(d.getDate() - 1)) {
                    const dateStr = d.toISOString().split('T')[0];
                    const dayOfWeek = d.getDay();
                    
                    // Skip Fridays
                    if (dayOfWeek === 5) continue;

                    // Skip dates before DOJ
                    if (doj && d < doj) break;

                    const status = laborAttendance[dateStr];
                    
                    if (!status || status === 'A') {
                        streak++;
                    } else {
                        break;
                    }
                }

                if (streak >= 3) {
                    streaks[labor.labor_id] = streak;
                }
            }

            return { success: true, data: streaks };
        } catch (error) {
            console.error('Get all absent streaks error:', error);
            return { success: false, data: {}, error: error.message };
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

    // Parse time string to minutes
    parseTimeToMinutes(timeStr) {
        if (!timeStr) return 0;
        try {
            const [hours, minutes] = timeStr.split(':').map(Number);
            return hours * 60 + minutes;
        } catch {
            return 0;
        }
    },

    // Format minutes to HH:MM
    formatMinutesToHHMM(minutes) {
        if (!minutes || minutes <= 0) return '';
        const h = Math.floor(minutes / 60);
        const m = Math.round(minutes % 60);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    },

    // Calculate hours between two time strings
    calculateHours(firstIn, lastOut) {
        if (!firstIn || !lastOut) return 0;
        try {
            const inMinutes = this.parseTimeToMinutes(firstIn);
            const outMinutes = this.parseTimeToMinutes(lastOut);
            if (outMinutes <= inMinutes) return 0;
            return outMinutes - inMinutes;
        } catch {
            return 0;
        }
    },

    // Determine status based on worked hours and min hours
    determineStatus(workedMinutes, minHoursFullDay) {
        if (!workedMinutes || workedMinutes <= 0) return 'A';
        
        const fullDayMinutes = this.parseTimeToMinutes(minHoursFullDay || '09:30');
        const halfDayMinutes = fullDayMinutes / 2;

        if (workedMinutes >= fullDayMinutes) {
            return 'P';
        } else if (workedMinutes >= halfDayMinutes) {
            return 'H';
        } else {
            return 'A';
        }
    },

    // Get monthly summary for 3PL billing
    async getMonthlyBilling(year, month, departmentId = null, statusFilter = 'active') {
        try {
            const departmentFilter = departmentId || AUTH.getDepartmentFilter();
            
            // Calculate date range
            const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
            const lastDay = new Date(year, month, 0).getDate();
            const endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;

            // Get departments with min_hours_full_day
            const { data: deptData, error: deptError } = await supabaseClient
                .from('departments')
                .select('id, min_hours_full_day')
                .eq('client_id', AUTH.getClientId());
            
            if (deptError) throw deptError;

            // Build department min hours map
            const deptMinHoursMap = {};
            (deptData || []).forEach(d => {
                deptMinHoursMap[d.id] = d.min_hours_full_day || '09:30';
            });

            // Get laborers based on status filter
            let laborQuery = supabaseClient
                .from('laborers')
                .select('labor_id, iqama_number, name, date_of_joining, department_id, status, last_working_date, role, monthly_salary')
                .eq('client_id', AUTH.getClientId());

            if (departmentFilter) {
                laborQuery = laborQuery.eq('department_id', departmentFilter);
            }

            // Apply status filter logic
            if (statusFilter === 'active') {
                // Active laborers OR laborers who became inactive during/after this month
                laborQuery = laborQuery.or(`status.eq.active,and(status.eq.inactive,last_working_date.gte.${startDate})`);
            } else if (statusFilter === 'inactive') {
                // Inactive laborers whose last_working_date is before this month
                laborQuery = laborQuery.eq('status', 'inactive').lt('last_working_date', startDate);
            }
            // If statusFilter is empty/all, no additional filter

            const { data: laborers, error: laborError } = await laborQuery;
            if (laborError) throw laborError;

            // Natural sort by labor_id (L1, L2, L3... not L1, L10, L11)
            laborers.sort((a, b) => {
                const aNum = parseInt(a.labor_id.replace(/\D/g, '')) || 0;
                const bNum = parseInt(b.labor_id.replace(/\D/g, '')) || 0;
                return aNum - bNum;
            });

            // Get all attendance records for the month
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
                const lastWorkingDate = laborer.last_working_date ? new Date(laborer.last_working_date) : null;
                const minHours = deptMinHoursMap[laborer.department_id] || '09:30';
                const monthlySalary = laborer.monthly_salary || 3000;

                const days = {};
                let presentCount = 0;
                let halfDayCount = 0;
                let absentCount = 0;
                let fridayCount = 0;
                let totalMinutes = 0;

                for (let day = 1; day <= lastDay; day++) {
                    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const dateObj = new Date(dateStr);
                    const isFriday = dateObj.getDay() === 5;
                    const isBeforeDOJ = dateObj < doj;
                    const isAfterLWD = lastWorkingDate && dateObj > lastWorkingDate;

                    const key = `${laborer.labor_id}_${dateStr}`;
                    const record = attendanceMap[key] || null;
                    let firstIn = record ? record.firstIn : null;
                    let lastOut = record ? record.lastOut : null;
                    let workedMinutes = this.calculateHours(firstIn, lastOut);
                    let status = null;
                    let hours = '';

                    if (isBeforeDOJ || isAfterLWD) {
                        // Before joining or after last working date = Absent
                        status = 'A';
                        absentCount++;
                        firstIn = null;
                        lastOut = null;
                        workedMinutes = 0;
                    } else if (isFriday) {
                        // Sandwich rule: Thu Absent + Sat Absent = Fri Absent
                        const thursdayStr = `${year}-${String(month).padStart(2, '0')}-${String(day - 1).padStart(2, '0')}`;
                        const saturdayStr = `${year}-${String(month).padStart(2, '0')}-${String(day + 1).padStart(2, '0')}`;
                        
                        const thursdayKey = `${laborer.labor_id}_${thursdayStr}`;
                        const saturdayKey = `${laborer.labor_id}_${saturdayStr}`;
                        
                        // Get Thursday status
                        let thursdayStatus = 'A';
                        const thursdayRecord = attendanceMap[thursdayKey];
                        if (thursdayRecord && thursdayRecord.firstIn && thursdayRecord.lastOut) {
                            const thuMinutes = this.calculateHours(thursdayRecord.firstIn, thursdayRecord.lastOut);
                            thursdayStatus = this.determineStatus(thuMinutes, minHours);
                        } else if (thursdayRecord && thursdayRecord.status) {
                            thursdayStatus = thursdayRecord.status;
                        }

                        // Get Saturday status
                        let saturdayStatus = 'A';
                        if (day + 1 <= lastDay) {
                            const saturdayRecord = attendanceMap[saturdayKey];
                            if (saturdayRecord && saturdayRecord.firstIn && saturdayRecord.lastOut) {
                                const satMinutes = this.calculateHours(saturdayRecord.firstIn, saturdayRecord.lastOut);
                                saturdayStatus = this.determineStatus(satMinutes, minHours);
                            } else if (saturdayRecord && saturdayRecord.status) {
                                saturdayStatus = saturdayRecord.status;
                            }
                        }

                        if (thursdayStatus === 'A' && saturdayStatus === 'A') {
                            status = 'A';
                            absentCount++;
                        } else {
                            status = 'F';
                            fridayCount++;
                        }
                        // Clear in/out for Friday
                        firstIn = null;
                        lastOut = null;
                        workedMinutes = 0;
                    } else if (workedMinutes > 0) {
                        // Calculate status based on worked hours
                        status = this.determineStatus(workedMinutes, minHours);
                        hours = this.formatMinutesToHHMM(workedMinutes);
                        totalMinutes += workedMinutes;

                        if (status === 'P') presentCount++;
                        else if (status === 'H') halfDayCount++;
                        else absentCount++;
                    } else if (record && record.status) {
                        // Has record but no punch times (LOP approved)
                        status = record.status;
                        if (status === 'P') presentCount++;
                        else if (status === 'H') halfDayCount++;
                        else absentCount++;
                    } else {
                        // No punch = Absent
                        status = 'A';
                        absentCount++;
                    }

                    days[day] = {
                        status: status,
                        in: this.formatTime12h(firstIn),
                        out: this.formatTime12h(lastOut),
                        hours: hours
                    };
                }

                // Calculate total paid days: P*1 + F*1 + H*0.5
                const totalPaidDays = presentCount + fridayCount + (halfDayCount * 0.5);

                // Calculate salary: (totalPaidDays / 30) * monthlySalary
                const calculatedSalary = Math.round((totalPaidDays / 30) * monthlySalary);

                return {
                    laborId: laborer.labor_id,
                    iqamaNumber: laborer.iqama_number,
                    name: laborer.name,
                    dateOfJoining: laborer.date_of_joining,
                    lastWorkingDate: laborer.last_working_date,
                    role: laborer.role || 'Labor',
                    monthlySalary: monthlySalary,
                    days,
                    presentCount,
                    halfDayCount,
                    absentCount,
                    fridayCount,
                    totalPaidDays,
                    totalHours: this.formatMinutesToHHMM(totalMinutes),
                    totalMinutes,
                    calculatedSalary
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

    // Approve LOP (single) - works for both existing and new records
    async approveLOP(attendanceId, reason, laborId = null, date = null, departmentId = null) {
        try {
            // If no attendanceId, create new record
            if (!attendanceId && laborId && date && departmentId) {
                return await this.createAbsentAndApprove(laborId, date, departmentId, reason);
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
                    final_status: originalStatus || 'A',
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
    // Check if a date is frozen
async isDateFrozen(date) {
    try {
        const clientId = AUTH.getClientId();
        
        const { data, error } = await supabaseClient
            .from('attendance_freeze')
            .select('id')
            .eq('client_id', clientId)
            .eq('date', date)
            .single();

        if (error && error.code !== 'PGRST116') {
            throw error;
        }

        return { success: true, frozen: !!data };
    } catch (error) {
        console.error('Check freeze error:', error);
        return { success: false, frozen: false };
    }
},

// Freeze a date (admin only)
async freezeDate(date) {
    try {
        if (!AUTH.hasRole('admin')) {
            return { success: false, error: 'Only admin can freeze attendance' };
        }

        const clientId = AUTH.getClientId();
        const session = AUTH.getSession();

        const { error } = await supabaseClient
            .from('attendance_freeze')
            .insert({
                client_id: clientId,
                date: date,
                frozen_by: session.name
            });

        if (error) {
            if (error.code === '23505') {
                return { success: false, error: 'This date is already frozen' };
            }
            throw error;
        }

        return { success: true };
    } catch (error) {
        console.error('Freeze date error:', error);
        return { success: false, error: error.message };
    }
},

// Get frozen dates for a range
async getFrozenDates(fromDate, toDate) {
    try {
        const clientId = AUTH.getClientId();

        const { data, error } = await supabaseClient
            .from('attendance_freeze')
            .select('date, frozen_by, frozen_at')
            .eq('client_id', clientId)
            .gte('date', fromDate)
            .lte('date', toDate);

        if (error) throw error;

        return { success: true, data: data || [] };
    } catch (error) {
        console.error('Get frozen dates error:', error);
        return { success: false, data: [] };
    }
}
};
