// AK Attendance - Report API v7 (sandwich rule block fix + cross-month + per-client toggles)
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
                .order('date', { ascending: false })
                .limit(5000);

            if (departmentFilter) {
                query = query.eq('department_id', departmentFilter);
            }

            const { data, error } = await query;
            if (error) throw error;
            if (data?.length === 5000) console.warn('Daily attendance hit 5000 record limit');
            return { success: true, data: data || [], limited: data?.length === 5000 };
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

            let laborQuery = supabaseClient
                .from('laborers')
                .select('labor_id, name, iqama_number, department_id, date_of_joining, status, role')
                .eq('client_id', clientId)
                .eq('status', 'active')
                .limit(2000);

            if (departmentFilter) {
                laborQuery = laborQuery.eq('department_id', departmentFilter);
            }

            const { data: laborers, error: laborError } = await laborQuery;
            if (laborError) throw laborError;
            if (laborers?.length === 2000) console.warn('Complete attendance laborers hit 2000 record limit');

            // Fetch ±1 day buffer for sandwich rule boundary lookups
            const bufferFrom = new Date(fromDate);
            bufferFrom.setDate(bufferFrom.getDate() - 1);
            const bufferTo = new Date(toDate);
            bufferTo.setDate(bufferTo.getDate() + 1);
            const pad = n => String(n).padStart(2, '0');
            const bufferFromStr = `${bufferFrom.getFullYear()}-${pad(bufferFrom.getMonth()+1)}-${pad(bufferFrom.getDate())}`;
            const bufferToStr = `${bufferTo.getFullYear()}-${pad(bufferTo.getMonth()+1)}-${pad(bufferTo.getDate())}`;

            // Run all remaining queries in parallel to minimise latency
            let attendanceQuery = supabaseClient
                .from('daily_attendance')
                .select('*')
                .eq('client_id', clientId)
                .gte('date', bufferFromStr)
                .lte('date', bufferToStr);
            if (departmentFilter) attendanceQuery = attendanceQuery.eq('department_id', departmentFilter);

            let punchQuery = supabaseClient
                .from('punch_records')
                .select('labor_id, date, time, location_name')
                .eq('client_id', clientId)
                .gte('date', fromDate)
                .lte('date', toDate)
                .order('time', { ascending: true });
            if (departmentFilter) punchQuery = punchQuery.eq('department_id', departmentFilter);

            const deptQuery = supabaseClient
                .from('departments')
                .select('id, name, min_hours_full_day')
                .eq('client_id', clientId);

            const holidayQuery = supabaseClient
                .from('holidays')
                .select('date, name')
                .eq('client_id', clientId)
                .eq('is_active', true)
                .gte('date', bufferFromStr)
                .lte('date', bufferToStr);

            const settingsQuery = supabaseClient
                .from('settings')
                .select('key, value')
                .in('key', ['sandwich_rule_friday', 'sandwich_rule_nh']);

            const [
                { data: attendance, error: attError },
                { data: punches, error: punchError },
                { data: departments },
                { data: holidaysData },
                { data: settingsData }
            ] = await Promise.all([attendanceQuery, punchQuery, deptQuery, holidayQuery, settingsQuery]);

            if (attError) throw attError;
            if (punchError) throw punchError;

            const punchLocationMap = {};
            const punchTimeMap = {};
            (punches || []).forEach(p => {
                const key = `${p.labor_id}_${p.date}`;
                if (!punchLocationMap[key]) punchLocationMap[key] = p.location_name || '';
                if (!punchTimeMap[key]) punchTimeMap[key] = { firstIn: p.time, lastOut: p.time };
                else {
                    if (p.time < punchTimeMap[key].firstIn) punchTimeMap[key].firstIn = p.time;
                    if (p.time > punchTimeMap[key].lastOut) punchTimeMap[key].lastOut = p.time;
                }
            });

            const deptMap = {};
            const deptMinHoursMap = {};
            (departments || []).forEach(d => {
                deptMap[d.id] = d.name;
                deptMinHoursMap[d.id] = d.min_hours_full_day || '09:30';
            });

            const holidayMap = {};
            (holidaysData || []).forEach(h => { holidayMap[h.date] = h.name; });

            const settingsMap = {};
            (settingsData || []).forEach(s => { settingsMap[s.key] = s.value; });
            const fridaySandwichEnabled = settingsMap['sandwich_rule_friday'] !== 'false';
            const nhSandwichEnabled = settingsMap['sandwich_rule_nh'] !== 'false';

            const attendanceMap = {};
            (attendance || []).forEach(a => {
                const key = `${a.labor_id}_${a.date}`;
                attendanceMap[key] = a;
            });

            const result = [];
            const startDate = new Date(fromDate);
            const endDate = new Date(toDate);

            for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
                const dateStr = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
                const dayOfWeek = d.getDay();
                const isFriday = dayOfWeek === 5;
                const isNH = !!holidayMap[dateStr];

                for (const labor of laborers) {
                    const key = `${labor.labor_id}_${dateStr}`;
                    const record = attendanceMap[key];
                    const minHours = deptMinHoursMap[labor.department_id] || '09:30';

                    if (labor.date_of_joining && new Date(labor.date_of_joining) > d) {
                        continue;
                    }

                    // Determine sandwich-corrected status for NH and Friday days
                    let sandwichStatus = null;

                    if (isNH && nhSandwichEnabled) {
                        // Walk backward skipping all NHs and Fridays to find nearest real working day
                        let prevPtr = new Date(d);
                        prevPtr.setDate(prevPtr.getDate() - 1);
                        let prevDateStr = null;
                        while (prevPtr >= bufferFrom) {
                            const ps = `${prevPtr.getFullYear()}-${pad(prevPtr.getMonth()+1)}-${pad(prevPtr.getDate())}`;
                            if (prevPtr.getDay() !== 5 && !holidayMap[ps]) { prevDateStr = ps; break; }
                            prevPtr.setDate(prevPtr.getDate() - 1);
                        }
                        let nextPtr = new Date(d);
                        nextPtr.setDate(nextPtr.getDate() + 1);
                        let nextDateStr = null;
                        while (nextPtr <= bufferTo) {
                            const ns = `${nextPtr.getFullYear()}-${pad(nextPtr.getMonth()+1)}-${pad(nextPtr.getDate())}`;
                            if (nextPtr.getDay() !== 5 && !holidayMap[ns]) { nextDateStr = ns; break; }
                            nextPtr.setDate(nextPtr.getDate() + 1);
                        }

                        const getStatus = (dateKey, rec) => {
                            if (!dateKey) return 'P';
                            const r = attendanceMap[`${labor.labor_id}_${dateKey}`];
                            if (r && r.first_login && r.last_logout) return this.determineStatus(this.calculateHours(r.first_login, r.last_logout), minHours);
                            if (r && r.final_status) return r.final_status;
                            return 'A';
                        };
                        const prevStatus = getStatus(prevDateStr);
                        const nextStatus = getStatus(nextDateStr);
                        sandwichStatus = (prevStatus === 'A' && nextStatus === 'A') ? 'A' : 'NH';

                    } else if (isFriday && fridaySandwichEnabled) {
                        const thuDate = new Date(d);
                        thuDate.setDate(thuDate.getDate() - 1);
                        const satDate = new Date(d);
                        satDate.setDate(satDate.getDate() + 1);
                        const thuStr = `${thuDate.getFullYear()}-${pad(thuDate.getMonth()+1)}-${pad(thuDate.getDate())}`;
                        const satStr = `${satDate.getFullYear()}-${pad(satDate.getMonth()+1)}-${pad(satDate.getDate())}`;

                        let thuStatus;
                        if (holidayMap[thuStr]) {
                            thuStatus = 'P';
                        } else {
                            const tr = attendanceMap[`${labor.labor_id}_${thuStr}`];
                            if (tr && tr.first_login && tr.last_logout) thuStatus = this.determineStatus(this.calculateHours(tr.first_login, tr.last_logout), minHours);
                            else if (tr && tr.final_status) thuStatus = tr.final_status;
                            else thuStatus = 'A';
                        }

                        let satStatus;
                        if (holidayMap[satStr]) {
                            satStatus = 'P';
                        } else {
                            const sr = attendanceMap[`${labor.labor_id}_${satStr}`];
                            if (sr && sr.first_login && sr.last_logout) satStatus = this.determineStatus(this.calculateHours(sr.first_login, sr.last_logout), minHours);
                            else if (sr && sr.final_status) satStatus = sr.final_status;
                            else satStatus = 'A';
                        }

                        sandwichStatus = (thuStatus === 'A' && satStatus === 'A') ? 'A' : 'F';
                    }

                    const punchTimes = punchTimeMap[key];
                    if (record || punchTimes) {
                        // Always derive login/logout from actual punch records if available
                        const firstLogin = punchTimes ? punchTimes.firstIn : (record?.first_login || null);
                        const lastLogout = punchTimes ? punchTimes.lastOut : (record?.last_logout || null);
                        const totalHours = (firstLogin && lastLogout)
                            ? this.calculateHours(firstLogin, lastLogout) / 60
                            : (record?.total_hours || null);
                        const autoStatus = (firstLogin && lastLogout)
                            ? this.determineStatus(this.calculateHours(firstLogin, lastLogout), minHours)
                            : (isNH ? 'NH' : (isFriday ? 'F' : 'A'));
                        // Keep final_status only when manually overridden (LOP or manual approval)
                        const manualOverride = record && ['LP','LH','LA'].includes(record.final_status);
                        const effectiveStatus = sandwichStatus || (manualOverride ? record.final_status : autoStatus);
                        result.push({
                            ...(record || {}),
                            labor_id: labor.labor_id,
                            department_id: labor.department_id,
                            date: dateStr,
                            first_login: firstLogin,
                            last_logout: lastLogout,
                            total_hours: totalHours,
                            auto_status: autoStatus,
                            final_status: effectiveStatus,
                            laborName: labor.name,
                            role: labor.role || 'Labor',
                            iqamaNumber: labor.iqama_number,
                            departmentName: deptMap[labor.department_id] || '-',
                            punchLocation: punchLocationMap[key] || '',
                            hasRecord: true,
                            isFriday
                        });
                    } else {
                        const autoStatus = isNH ? 'NH' : (isFriday ? 'F' : 'A');
                        const effectiveStatus = sandwichStatus || autoStatus;
                        result.push({
                            id: null,
                            labor_id: labor.labor_id,
                            department_id: labor.department_id,
                            date: dateStr,
                            first_login: null,
                            last_logout: null,
                            total_hours: null,
                            auto_status: autoStatus,
                            final_status: effectiveStatus,
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
                            isFriday
                        });
                    }
                }
            }

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
    async createAbsentAndApprove(laborId, date, departmentId, reason, finalStatus = 'P') {
        try {
            const session = AUTH.getSession();
            const clientId = AUTH.getClientId();

            const { data: existing } = await supabaseClient
                .from('daily_attendance')
                .select('id')
                .eq('client_id', clientId)
                .eq('labor_id', laborId)
                .eq('date', date)
                .single();

            if (existing) {
                const { error } = await supabaseClient
                    .from('daily_attendance')
                    .update({
                        final_status: finalStatus,
                        approved_by: session.name,
                        approved_at: new Date().toISOString(),
                        lop_reason: reason
                    })
                    .eq('id', existing.id);

                if (error) throw error;
                return { success: true, recordId: existing.id };
            }

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
                    final_status: finalStatus,
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
            
            const thirtyDaysAgo = new Date(today);
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

            const { data: attendance, error } = await supabaseClient
                .from('daily_attendance')
                .select('date, final_status')
                .eq('client_id', clientId)
                .eq('labor_id', laborId)
                .gte('date', thirtyDaysAgoStr)
                .lte('date', todayStr)
                .order('date', { ascending: false });

            if (error) throw error;

            const attendanceMap = {};
            (attendance || []).forEach(a => {
                attendanceMap[a.date] = a.final_status;
            });

            let streak = 0;
            for (let d = new Date(today); d >= thirtyDaysAgo; d.setDate(d.getDate() - 1)) {
                const dateStr = d.toISOString().split('T')[0];
                const dayOfWeek = d.getDay();
                if (dayOfWeek === 5) continue;

                const status = attendanceMap[dateStr];
                if (!status || status === 'A') {
                    streak++;
                } else {
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
            
            const thirtyDaysAgo = new Date(today);
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

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

            const attendanceByLabor = {};
            (attendance || []).forEach(a => {
                if (!attendanceByLabor[a.labor_id]) {
                    attendanceByLabor[a.labor_id] = {};
                }
                attendanceByLabor[a.labor_id][a.date] = a.final_status;
            });

            const streaks = {};
            for (const labor of laborers) {
                const laborAttendance = attendanceByLabor[labor.labor_id] || {};
                let streak = 0;
                const doj = labor.date_of_joining ? new Date(labor.date_of_joining) : null;

                for (let d = new Date(today); d >= thirtyDaysAgo; d.setDate(d.getDate() - 1)) {
                    const dateStr = d.toISOString().split('T')[0];
                    const dayOfWeek = d.getDay();
                    if (dayOfWeek === 5) continue;
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

    // Calculate hours between two time strings (handles cross-midnight night shifts)
    calculateHours(firstIn, lastOut) {
        if (!firstIn || !lastOut) return 0;
        try {
            const inMinutes  = this.parseTimeToMinutes(firstIn);
            const outMinutes = this.parseTimeToMinutes(lastOut);
            if (outMinutes > inMinutes) return outMinutes - inMinutes;
            // Cross-midnight: logout time is less than login (night shift spanning midnight)
            // Guard: only treat as cross-midnight if the apparent "backwards" gap exceeds 6h
            if (inMinutes - outMinutes > 6 * 60) {
                return (24 * 60 - inMinutes) + outMinutes;
            }
            return 0;
        } catch {
            return 0;
        }
    },

    // Determine status based on worked hours and min hours
    determineStatus(workedMinutes, minHoursFullDay) {
        if (!workedMinutes || workedMinutes <= 0) return 'A';
        const fullDayMinutes = this.parseTimeToMinutes(minHoursFullDay || '09:30');
        const halfDayMinutes = fullDayMinutes / 2;
        if (workedMinutes >= fullDayMinutes) return 'P';
        else if (workedMinutes >= halfDayMinutes) return 'H';
        else return 'A';
    },

    // Get monthly summary for 3PL billing
    async getMonthlyBilling(year, month, departmentId = null, statusFilter = 'active') {
        try {
            const departmentFilter = departmentId || AUTH.getDepartmentFilter();
            
            const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
            const lastDay = new Date(year, month, 0).getDate();
            const endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;

            const { data: deptData, error: deptError } = await supabaseClient
                .from('departments')
                .select('id, min_hours_full_day')
                .eq('client_id', AUTH.getClientId());
            
            if (deptError) throw deptError;

            const deptMinHoursMap = {};
            (deptData || []).forEach(d => {
                deptMinHoursMap[d.id] = d.min_hours_full_day || '09:30';
            });

            let laborQuery = supabaseClient
                .from('laborers')
                .select('labor_id, iqama_number, name, date_of_joining, department_id, status, last_working_date, role, monthly_salary')
                .eq('client_id', AUTH.getClientId());

            if (departmentFilter) {
                laborQuery = laborQuery.eq('department_id', departmentFilter);
            }

            if (statusFilter === 'active') {
                laborQuery = laborQuery.or(`status.eq.active,and(status.eq.inactive,last_working_date.gte.${startDate})`);
            } else if (statusFilter === 'inactive') {
                laborQuery = laborQuery.eq('status', 'inactive').lt('last_working_date', startDate);
            }

            const { data: laborers, error: laborError } = await laborQuery;
            if (laborError) throw laborError;

            laborers.sort((a, b) => {
                const aNum = parseInt(a.labor_id.replace(/\D/g, '')) || 0;
                const bNum = parseInt(b.labor_id.replace(/\D/g, '')) || 0;
                return aNum - bNum;
            });

            // Fetch 1 day before and after to handle boundary Fridays
            // (e.g. Friday = 1st of month needs Thursday from previous month)
            const prevDay = new Date(year, month - 1, 0); // last day of prev month
            const nextDay = new Date(year, month, 1);      // first day of next month
            const fetchFrom = prevDay.toISOString().split('T')[0];
            const fetchTo = nextDay.toISOString().split('T')[0];

            let attendanceQuery = supabaseClient
                .from('daily_attendance')
                .select('labor_id, date, final_status, first_login, last_logout')
                .eq('client_id', AUTH.getClientId())
                .gte('date', fetchFrom)
                .lte('date', fetchTo);

            if (departmentFilter) {
                attendanceQuery = attendanceQuery.eq('department_id', departmentFilter);
            }

            const { data: attendance, error: attError } = await attendanceQuery;
            if (attError) throw attError;

            // Get holidays — extend range ±1 day to match attendance buffer (cross-month blocks)
            const { data: holidaysData } = await supabaseClient
                .from('holidays')
                .select('date, name')
                .eq('client_id', AUTH.getClientId())
                .eq('is_active', true)
                .gte('date', fetchFrom)
                .lte('date', fetchTo);

            const holidayMap = {};
            (holidaysData || []).forEach(h => {
                holidayMap[h.date] = h.name;
            });

            // Load sandwich rule toggles — default ON if key not present
            const { data: settingsData } = await supabaseClient
                .from('settings')
                .select('key, value')
                .in('key', ['sandwich_rule_friday', 'sandwich_rule_nh']);
            const settingsMap = {};
            (settingsData || []).forEach(s => { settingsMap[s.key] = s.value; });
            const fridaySandwichEnabled = settingsMap['sandwich_rule_friday'] !== 'false';
            const nhSandwichEnabled = settingsMap['sandwich_rule_nh'] !== 'false';

            const attendanceMap = {};
            (attendance || []).forEach(a => {
                const key = `${a.labor_id}_${a.date}`;
                attendanceMap[key] = {
                    status: a.final_status,
                    firstIn: a.first_login,
                    lastOut: a.last_logout
                };
            });

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
                let holidayCount = 0;
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
                        status = 'A';
                        absentCount++;
                        firstIn = null;
                        lastOut = null;
                        workedMinutes = 0;

                    } else if (holidayMap[dateStr]) {
                        if (nhSandwichEnabled) {
                            // NH sandwich rule — treat entire consecutive NH+Friday block as one unit.
                            // Skip backward over all NHs and Fridays to find the nearest real working day.
                            // Cross-month: allowed to step into the ±1 buffer day.
                            const pad = n => String(n).padStart(2, '0');
                            const bufferPrev = new Date(year, month - 1, 0); // last day of prev month

                            let prevPtr = new Date(year, month - 1, day - 1);
                            let prevDateStr = null;
                            while (prevPtr >= bufferPrev) {
                                const ps = `${prevPtr.getFullYear()}-${pad(prevPtr.getMonth()+1)}-${pad(prevPtr.getDate())}`;
                                if (prevPtr.getDay() !== 5 && !holidayMap[ps]) { prevDateStr = ps; break; }
                                prevPtr.setDate(prevPtr.getDate() - 1);
                            }

                            // Skip forward over all NHs and Fridays to find the nearest real working day.
                            const bufferNext = new Date(year, month, 1); // first day of next month

                            let nextPtr = new Date(year, month - 1, day + 1);
                            let nextDateStr = null;
                            while (nextPtr <= bufferNext) {
                                const ns = `${nextPtr.getFullYear()}-${pad(nextPtr.getMonth()+1)}-${pad(nextPtr.getDate())}`;
                                if (nextPtr.getDay() !== 5 && !holidayMap[ns]) { nextDateStr = ns; break; }
                                nextPtr.setDate(nextPtr.getDate() + 1);
                            }

                            // No working day found before block → benefit of doubt = Present
                            let prevStatus = 'P';
                            if (prevDateStr) {
                                const prevKey = `${laborer.labor_id}_${prevDateStr}`;
                                const prevRecord = attendanceMap[prevKey];
                                if (prevRecord && prevRecord.firstIn && prevRecord.lastOut) {
                                    prevStatus = this.determineStatus(this.calculateHours(prevRecord.firstIn, prevRecord.lastOut), minHours);
                                } else if (prevRecord && prevRecord.status) {
                                    prevStatus = prevRecord.status;
                                } else {
                                    prevStatus = 'A';
                                }
                            }

                            // No working day found after block → benefit of doubt = Present
                            let nextStatus = 'P';
                            if (nextDateStr) {
                                const nextKey = `${laborer.labor_id}_${nextDateStr}`;
                                const nextRecord = attendanceMap[nextKey];
                                if (nextRecord && nextRecord.firstIn && nextRecord.lastOut) {
                                    nextStatus = this.determineStatus(this.calculateHours(nextRecord.firstIn, nextRecord.lastOut), minHours);
                                } else if (nextRecord && nextRecord.status) {
                                    nextStatus = nextRecord.status;
                                } else {
                                    nextStatus = 'A';
                                }
                            }

                            if (prevStatus === 'A' && nextStatus === 'A') {
                                status = 'A';
                                absentCount++;
                            } else {
                                status = 'NH';
                                holidayCount++;
                            }
                        } else {
                            status = 'NH';
                            holidayCount++;
                        }
                        firstIn = null;
                        lastOut = null;
                        workedMinutes = 0;

                    } else if (isFriday) {
                        if (fridaySandwichEnabled) {
                            // Friday sandwich rule — cross-month boundary aware.
                            // If Thursday or Saturday is itself an NH, treat it as Present (paid holiday ≠ absent).
                            const pad = n => String(n).padStart(2, '0');
                            const thuDate = new Date(year, month - 1, day - 1);
                            const satDate = new Date(year, month - 1, day + 1);
                            const thursdayStr = `${thuDate.getFullYear()}-${pad(thuDate.getMonth()+1)}-${pad(thuDate.getDate())}`;
                            const saturdayStr = `${satDate.getFullYear()}-${pad(satDate.getMonth()+1)}-${pad(satDate.getDate())}`;

                            let thursdayStatus;
                            if (holidayMap[thursdayStr]) {
                                thursdayStatus = 'P'; // NH neighbor = Present
                            } else {
                                thursdayStatus = 'A';
                                const thursdayRecord = attendanceMap[`${laborer.labor_id}_${thursdayStr}`];
                                if (thursdayRecord && thursdayRecord.firstIn && thursdayRecord.lastOut) {
                                    thursdayStatus = this.determineStatus(this.calculateHours(thursdayRecord.firstIn, thursdayRecord.lastOut), minHours);
                                } else if (thursdayRecord && thursdayRecord.status) {
                                    thursdayStatus = thursdayRecord.status;
                                }
                            }

                            let saturdayStatus;
                            if (holidayMap[saturdayStr]) {
                                saturdayStatus = 'P'; // NH neighbor = Present
                            } else {
                                saturdayStatus = 'A';
                                const saturdayRecord = attendanceMap[`${laborer.labor_id}_${saturdayStr}`];
                                if (saturdayRecord && saturdayRecord.firstIn && saturdayRecord.lastOut) {
                                    saturdayStatus = this.determineStatus(this.calculateHours(saturdayRecord.firstIn, saturdayRecord.lastOut), minHours);
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
                        } else {
                            status = 'F';
                            fridayCount++;
                        }
                        firstIn = null;
                        lastOut = null;
                        workedMinutes = 0;

                    } else if (workedMinutes > 0) {
                        // FIX 2: Respect final_status if admin approved LOP (H→P)
                        if (record && record.status === 'P') {
                            status = 'P';
                            presentCount++;
                        } else {
                            status = this.determineStatus(workedMinutes, minHours);
                            if (status === 'P') presentCount++;
                            else if (status === 'H') halfDayCount++;
                            else absentCount++;
                        }
                        hours = this.formatMinutesToHHMM(workedMinutes);
                        totalMinutes += workedMinutes;

                    } else if (record && record.status) {
                        // Has record but no punch times (LOP approved absent)
                        status = record.status;
                        if (status === 'P') presentCount++;
                        else if (status === 'H') halfDayCount++;
                        else absentCount++;
                    } else {
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

                // P*1 + F*1 + NH*1 + H*0.5
                const totalPaidDays = presentCount + fridayCount + holidayCount + (halfDayCount * 0.5);

                // FIX 3: Salary based on actual days in month (28/29/30/31)
                const calculatedSalary = Math.round((totalPaidDays / lastDay) * monthlySalary);

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
                    holidayCount,
                    totalPaidDays,
                    totalHours: this.formatMinutesToHHMM(totalMinutes),
                    totalMinutes,
                    calculatedSalary
                };
            });

            return { 
                success: true, 
                data: reportData,
                meta: { year, month, totalDays: lastDay, startDate, endDate }
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

            let lopQuery = supabaseClient
                .from('daily_attendance')
                .select('id', { count: 'exact', head: true })
                .eq('client_id', AUTH.getClientId())
                .eq('date', today)
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
    async approveLOP(attendanceId, reason, laborId = null, date = null, departmentId = null, finalStatus = 'P') {
        try {
            if (!attendanceId && laborId && date && departmentId) {
                return await this.createAbsentAndApprove(laborId, date, departmentId, reason, finalStatus);
            }

            const session = AUTH.getSession();

            const { error } = await supabaseClient
                .from('daily_attendance')
                .update({
                    final_status: finalStatus,
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
                    lop_reason: null,
                    lop_request_id: null
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
        const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1);
        return now < nextMonth;
    },

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
