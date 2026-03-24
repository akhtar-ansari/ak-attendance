// AK Attendance - Sync Manager
const SyncManager = {
    isSyncing: false,
    lastSyncTime: null,

    // Initialize sync manager
    async init() {
        // Listen for online event
        window.addEventListener('online', () => {
            console.log('[SyncManager] Online detected');
            this.syncAll();
        });

        // Listen for service worker messages
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('message', (event) => {
                if (event.data.type === 'SYNC_PUNCHES') {
                    this.syncPunches();
                }
            });
        }

        // Initial sync if online
        if (navigator.onLine) {
            this.syncAll();
        }

        console.log('[SyncManager] Initialized');
    },

    // Check if online
    isOnline() {
        return navigator.onLine;
    },

    // Sync everything
    async syncAll() {
        if (this.isSyncing) {
            console.log('[SyncManager] Already syncing...');
            return;
        }

        if (!this.isOnline()) {
            console.log('[SyncManager] Offline, skipping sync');
            return;
        }

        this.isSyncing = true;
        console.log('[SyncManager] Starting full sync...');

        try {
            // Sync punches first (upload local data)
            await this.syncPunches();

            // Download fresh data
            await this.downloadFaceDescriptors();
            await this.downloadPunchLocations();

            // Cleanup old data
            await OfflineStorage.cleanupOldPunches();

            this.lastSyncTime = new Date();
            await OfflineStorage.saveSetting('lastSyncTime', this.lastSyncTime.toISOString());

            console.log('[SyncManager] Full sync complete');
        } catch (error) {
            console.error('[SyncManager] Sync error:', error);
        } finally {
            this.isSyncing = false;
        }
    },

    // Sync offline punches to server
    async syncPunches() {
        if (!this.isOnline()) return;

        try {
            const unsyncedPunches = await OfflineStorage.getUnsyncedPunches();
            
            if (unsyncedPunches.length === 0) {
                console.log('[SyncManager] No punches to sync');
                return;
            }

            console.log(`[SyncManager] Syncing ${unsyncedPunches.length} punches...`);

            // Track which labor+date combinations need recalculation
            const recalculateSet = new Set();

            for (const punch of unsyncedPunches) {
                try {
                    // Upload photo if exists
                    let photoUrl = null;
                    if (punch.photoBlob) {
                        const photoResult = await PunchAPI.uploadPhoto(punch.laborId, punch.photoBlob);
                        if (photoResult.success) {
                            photoUrl = photoResult.url;
                        }
                    }

                    // Save punch to server (type will be fixed after all synced)
                    const result = await PunchAPI.savePunch({
                        laborId: punch.laborId,
                        departmentId: punch.departmentId,
                        date: punch.date,
                        time: punch.time,
                        type: 'punch',
                        locationId: punch.locationId,
                        locationName: punch.locationName,
                        confidence: punch.confidence,
                        photoUrl: photoUrl
                    });

                    if (result.success) {
                        await OfflineStorage.markPunchSynced(punch.id);
                        console.log(`[SyncManager] Punch ${punch.id} synced`);
                        
                        // Track for recalculation
                        recalculateSet.add(`${punch.laborId}|${punch.date}`);
                        
                        // Update last_sync_at for this laborer
                        await supabaseClient
                            .from('laborers')
                            .update({ last_sync_at: new Date().toISOString() })
                            .eq('labor_id', punch.laborId);
                    }
                } catch (err) {
                    console.error(`[SyncManager] Failed to sync punch ${punch.id}:`, err);
                }
            }

            // Fix punch types and recalculate attendance for affected days
            for (const key of recalculateSet) {
                const [laborId, date] = key.split('|');
                await this.recalculateDailyAttendance(laborId, date);
            }

        } catch (error) {
            console.error('[SyncManager] Sync punches error:', error);
        }
    },

        // Recalculate daily attendance for a labor+date
    async recalculateDailyAttendance(laborId, date) {
        try {
            console.log(`[SyncManager] Recalculating attendance for ${laborId} on ${date}`);

            // Call the database function
            const { error } = await supabaseClient
                .rpc('update_daily_attendance', {
                    p_labor_id: laborId,
                    p_date: date
                });

            if (error) {
                console.error('[SyncManager] RPC error:', error);
                // Fallback: manual calculation
                await this.manualRecalculate(laborId, date);
            } else {
                console.log(`[SyncManager] Attendance recalculated for ${laborId} on ${date}`);
            }

        } catch (error) {
            console.error(`[SyncManager] Recalculate attendance error:`, error);
        }
    },

    // Manual fallback recalculation
    async manualRecalculate(laborId, date) {
        try {
            // Get punches
            const { data: punches } = await supabaseClient
                .from('punch_records')
                .select('time, type')
                .eq('labor_id', laborId)
                .eq('date', date)
                .order('time', { ascending: true });

            if (!punches || punches.length === 0) return;

            // Find first login and last logout
            const firstLogin = punches.find(p => p.type === 'login');
            const lastLogout = [...punches].reverse().find(p => p.type === 'logout');

            let totalHours = 0;
            let status = 'A';

            if (firstLogin && lastLogout) {
                const [lh, lm] = firstLogin.time.split(':').map(Number);
                const [oh, om] = lastLogout.time.split(':').map(Number);
                totalHours = ((oh * 60 + om) - (lh * 60 + lm)) / 60;

                // Get settings for thresholds
                const { data: settings } = await supabaseClient
                    .from('settings')
                    .select('setting_value')
                    .in('setting_key', ['min_hours_present', 'min_hours_half_day']);

                let minPresent = 10, minHalf = 4;
                if (settings) {
                    settings.forEach(s => {
                        if (s.setting_key === 'min_hours_present') minPresent = parseFloat(s.setting_value);
                        if (s.setting_key === 'min_hours_half_day') minHalf = parseFloat(s.setting_value);
                    });
                }

                if (totalHours >= minPresent) status = 'P';
                else if (totalHours >= minHalf) status = 'H';
                else status = 'A';
            }

            // Get department
            const { data: labor } = await supabaseClient
                .from('laborers')
                .select('department_id')
                .eq('labor_id', laborId)
                .single();

            // Upsert daily attendance
            await supabaseClient
                .from('daily_attendance')
                .upsert({
                    labor_id: laborId,
                    department_id: labor?.department_id,
                    date: date,
                    first_login: firstLogin?.time || null,
                    last_logout: lastLogout?.time || null,
                    total_hours: totalHours,
                    auto_status: status,
                    final_status: status,
                    updated_at: new Date().toISOString()
                }, {
                    onConflict: 'labor_id,date'
                });

            console.log(`[SyncManager] Manual recalculation done: ${laborId} ${date} = ${totalHours.toFixed(2)}h, ${status}`);

        } catch (error) {
            console.error('[SyncManager] Manual recalculate error:', error);
        }
    },

    // Download face descriptors from server
    async downloadFaceDescriptors() {
        if (!this.isOnline()) return;

        try {
            console.log('[SyncManager] Downloading face descriptors...');

            const { data, error } = await supabaseClient
                .from('laborers')
                .select('labor_id, name, department_id, face_descriptor')
                .eq('status', 'active')
                .eq('face_enrolled', true);

            if (error) throw error;

            const descriptors = (data || []).map(l => ({
                laborId: l.labor_id,
                name: l.name,
                departmentId: l.department_id,
                descriptor: l.face_descriptor
            }));

            await OfflineStorage.saveFaceDescriptors(descriptors);
            console.log(`[SyncManager] Downloaded ${descriptors.length} descriptors`);
        } catch (error) {
            console.error('[SyncManager] Download descriptors error:', error);
        }
    },

    // Download punch locations from server
    async downloadPunchLocations() {
        if (!this.isOnline()) return;

        try {
            console.log('[SyncManager] Downloading punch locations...');

            const { data, error } = await supabaseClient
                .from('punch_locations')
                .select('*')
                .eq('status', 'active');

            if (error) throw error;

            await OfflineStorage.savePunchLocations(data || []);
            console.log(`[SyncManager] Downloaded ${data?.length || 0} locations`);
        } catch (error) {
            console.error('[SyncManager] Download locations error:', error);
        }
    },

    // Register for background sync
    async registerBackgroundSync() {
        if ('serviceWorker' in navigator && 'sync' in window.registration) {
            try {
                await navigator.serviceWorker.ready;
                await navigator.serviceWorker.sync.register('sync-punches');
                console.log('[SyncManager] Background sync registered');
            } catch (error) {
                console.log('[SyncManager] Background sync not supported');
            }
        }
    },

    // Get last sync time
    async getLastSyncTime() {
        const time = await OfflineStorage.getSetting('lastSyncTime');
        return time ? new Date(time) : null;
    },

    // Get sync status
    async getStatus() {
        const unsyncedCount = (await OfflineStorage.getUnsyncedPunches()).length;
        const lastSync = await this.getLastSyncTime();

        return {
            isOnline: this.isOnline(),
            isSyncing: this.isSyncing,
            unsyncedCount,
            lastSyncTime: lastSync
        };
    }
};
