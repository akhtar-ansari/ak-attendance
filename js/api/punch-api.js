// AK Attendance - Punch API
const PunchAPI = {
    // ========== PUNCH LOCATIONS ==========
    
    // Get all punch locations (filtered by department)
    async getLocations() {
        try {
            const departmentFilter = AUTH.getDepartmentFilter();
            
            let query = supabase
                .from('punch_locations')
                .select(`
                    *,
                    departments:department_id (id, name, code)
                `)
                .order('name');

            if (departmentFilter) {
                query = query.eq('department_id', departmentFilter);
            }

            const { data, error } = await query;

            if (error) throw error;
            return { success: true, data: data || [] };
        } catch (error) {
            console.error('Get locations error:', error);
            return { success: false, error: error.message };
        }
    },

    // Get active locations only
    async getActiveLocations() {
        try {
            const departmentFilter = AUTH.getDepartmentFilter();
            
            let query = supabase
                .from('punch_locations')
                .select(`
                    *,
                    departments:department_id (id, name, code)
                `)
                .eq('status', 'active')
                .order('name');

            if (departmentFilter) {
                query = query.eq('department_id', departmentFilter);
            }

            const { data, error } = await query;

            if (error) throw error;
            return { success: true, data: data || [] };
        } catch (error) {
            console.error('Get active locations error:', error);
            return { success: false, error: error.message };
        }
    },

    // Get locations by department
    async getLocationsByDepartment(departmentId) {
        try {
            const { data, error } = await supabase
                .from('punch_locations')
                .select('*')
                .eq('department_id', departmentId)
                .eq('status', 'active')
                .order('name');

            if (error) throw error;
            return { success: true, data: data || [] };
        } catch (error) {
            console.error('Get locations by department error:', error);
            return { success: false, error: error.message };
        }
    },

    // Create punch location
    async createLocation(location) {
        try {
            const { data, error } = await supabase
                .from('punch_locations')
                .insert({
                    name: location.name.trim(),
                    department_id: location.departmentId,
                    latitude: location.latitude,
                    longitude: location.longitude,
                    radius: location.radius || 100,
                    status: location.status || 'active'
                })
                .select(`
                    *,
                    departments:department_id (id, name, code)
                `)
                .single();

            if (error) throw error;

            await AUTH.logAction('CREATE', 'punch_locations', data.id, null, data);

            return { success: true, data };
        } catch (error) {
            console.error('Create location error:', error);
            return { success: false, error: error.message };
        }
    },

    // Update punch location
    async updateLocation(id, updates) {
        try {
            const { data: oldData } = await supabase
                .from('punch_locations')
                .select('*')
                .eq('id', id)
                .single();

            const { data, error } = await supabase
                .from('punch_locations')
                .update({
                    name: updates.name?.trim(),
                    department_id: updates.departmentId,
                    latitude: updates.latitude,
                    longitude: updates.longitude,
                    radius: updates.radius,
                    status: updates.status
                })
                .eq('id', id)
                .select(`
                    *,
                    departments:department_id (id, name, code)
                `)
                .single();

            if (error) throw error;

            await AUTH.logAction('UPDATE', 'punch_locations', id, oldData, data);

            return { success: true, data };
        } catch (error) {
            console.error('Update location error:', error);
            return { success: false, error: error.message };
        }
    },

    // Delete punch location
    async deleteLocation(id) {
        try {
            const { data: oldData } = await supabase
                .from('punch_locations')
                .select('*')
                .eq('id', id)
                .single();

            const { error } = await supabase
                .from('punch_locations')
                .delete()
                .eq('id', id);

            if (error) throw error;

            await AUTH.logAction('DELETE', 'punch_locations', id, oldData, null);

            return { success: true };
        } catch (error) {
            console.error('Delete location error:', error);
            return { success: false, error: error.message };
        }
    },

    // ========== PUNCH RECORDS ==========

    // Upload punch photo to Supabase Storage
    async uploadPhoto(laborId, photoBlob) {
        try {
            const timestamp = Date.now();
            const fileName = `${laborId}_${timestamp}.jpg`;
            const filePath = `punches/${fileName}`;

            const { data, error } = await supabaseClient.storage
                .from('punch-photos')
                .upload(filePath, photoBlob, {
                    contentType: 'image/jpeg',
                    upsert: false
                });

            if (error) throw error;

            // Get public URL
            const { data: urlData } = supabaseClient.storage
                .from('punch-photos')
                .getPublicUrl(filePath);

            return { success: true, url: urlData.publicUrl };
        } catch (error) {
            console.error('Upload photo error:', error);
            return { success: false, error: error.message };
        }
    },

    // Save punch record
    async savePunch(punch) {
        try {
            const { data, error } = await supabase
                .from('punch_records')
                .insert({
                    labor_id: punch.laborId,
                    department_id: punch.departmentId,
                    date: punch.date,
                    time: punch.time,
                    type: punch.type,
                    location_id: punch.locationId,
                    location_name: punch.locationName,
                    confidence: punch.confidence,
                    photo_url: punch.photoUrl
                })
                .select()
                .single();

            if (error) throw error;

            // Update daily attendance
            await supabaseClient.rpc('update_daily_attendance', {
                p_labor_id: punch.laborId,
                p_date: punch.date
            });

            return { success: true, data };
        } catch (error) {
            console.error('Save punch error:', error);
            return { success: false, error: error.message };
        }
    },

    // Get today's punches for a laborer
    async getTodayPunches(laborId) {
        try {
            const today = DateUtils.today();

            const { data, error } = await supabase
                .from('punch_records')
                .select('*')
                .eq('labor_id', laborId)
                .eq('date', today)
                .order('time');

            if (error) throw error;
            return { success: true, data: data || [] };
        } catch (error) {
            console.error('Get today punches error:', error);
            return { success: false, error: error.message };
        }
    },

    // Get punch records by date range
    async getPunchRecords(fromDate, toDate, laborId = null) {
        try {
            const departmentFilter = AUTH.getDepartmentFilter();
            
            let query = supabase
                .from('punch_records')
                .select('*')
                .gte('date', fromDate)
                .lte('date', toDate)
                .order('date', { ascending: false })
                .order('time', { ascending: false });

            if (laborId) {
                query = query.eq('labor_id', laborId);
            }

            if (departmentFilter) {
                query = query.eq('department_id', departmentFilter);
            }

            const { data, error } = await query;

            if (error) throw error;
            return { success: true, data: data || [] };
        } catch (error) {
            console.error('Get punch records error:', error);
            return { success: false, error: error.message };
        }
    },

    // Determine next punch type (login/logout)
    async getNextPunchType(laborId) {
        try {
            const today = DateUtils.today();
            
            const { data, error } = await supabase
                .from('punch_records')
                .select('type')
                .eq('labor_id', laborId)
                .eq('date', today)
                .order('time', { ascending: false })
                .limit(1);

            if (error) throw error;

            if (!data || data.length === 0) {
                return 'login';
            }

            return data[0].type === 'login' ? 'logout' : 'login';
        } catch (error) {
            console.error('Get next punch type error:', error);
            return 'login';
        }
    },

    // Check punch limit for the day
    async checkPunchLimit(laborId) {
        try {
            const today = DateUtils.today();

            // Get max punches setting
            const { data: settings } = await supabase
                .from('settings')
                .select('value')
                .eq('key', 'max_punches_per_day')
                .single();

            const maxPunches = parseInt(settings?.value || '999');

            // Count today's punches
            const { count, error } = await supabase
                .from('punch_records')
                .select('*', { count: 'exact', head: true })
                .eq('labor_id', laborId)
                .eq('date', today);

            if (error) throw error;

            return {
                success: true,
                allowed: count < maxPunches,
                current: count,
                max: maxPunches
            };
        } catch (error) {
            console.error('Check punch limit error:', error);
            return { success: false, error: error.message };
        }
    },

    // Calculate distance between two coordinates (in meters)
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371000; // Earth's radius in meters
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    },

    // Find nearest location within range for a department
    async findNearestLocation(userLat, userLng, departmentId) {
        try {
            const { data: locations, error } = await supabase
                .from('punch_locations')
                .select('*')
                .eq('department_id', departmentId)
                .eq('status', 'active');

            if (error) throw error;

            if (!locations || locations.length === 0) {
                return { success: false, error: 'No locations configured for department' };
            }

            let nearestLocation = null;
            let minDistance = Infinity;

            for (const loc of locations) {
                const distance = this.calculateDistance(
                    userLat, userLng,
                    parseFloat(loc.latitude), parseFloat(loc.longitude)
                );

                if (distance <= loc.radius && distance < minDistance) {
                    minDistance = distance;
                    nearestLocation = { ...loc, distance: Math.round(distance) };
                }
            }

            if (nearestLocation) {
                return { success: true, location: nearestLocation };
            } else {
                return { success: false, error: 'Outside punch area' };
            }
        } catch (error) {
            console.error('Find nearest location error:', error);
            return { success: false, error: error.message };
        }
    },

    // Delete old photos (for cleanup - photos older than retention days)
    async cleanupOldPhotos() {
        try {
            // Get retention days setting
            const { data: settings } = await supabase
                .from('settings')
                .select('value')
                .eq('key', 'photo_retention_days')
                .single();

            const retentionDays = parseInt(settings?.value || '30');
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
            const cutoffStr = cutoffDate.toISOString().split('T')[0];

            // Get old punch records with photos
            const { data: oldPunches } = await supabase
                .from('punch_records')
                .select('id, photo_url')
                .lt('date', cutoffStr)
                .not('photo_url', 'is', null);

            if (oldPunches && oldPunches.length > 0) {
                for (const punch of oldPunches) {
                    // Extract file path from URL
                    const url = punch.photo_url;
                    const pathMatch = url.match(/punch-photos\/(.+)$/);
                    if (pathMatch) {
                        await supabaseClient.storage
                            .from('punch-photos')
                            .remove([pathMatch[1]]);
                    }

                    // Clear photo_url in record
                    await supabase
                        .from('punch_records')
                        .update({ photo_url: null })
                        .eq('id', punch.id);
                }
            }

            return { success: true, cleaned: oldPunches?.length || 0 };
        } catch (error) {
            console.error('Cleanup old photos error:', error);
            return { success: false, error: error.message };
        }
    }
};