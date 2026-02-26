// AK Attendance - Offline Storage (IndexedDB)
const OfflineStorage = {
    DB_NAME: 'AKAttendanceDB',
    DB_VERSION: 1,
    db: null,

    // Initialize database
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                console.log('[OfflineStorage] Database ready');
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Offline punches store
                if (!db.objectStoreNames.contains('offlinePunches')) {
                    const punchStore = db.createObjectStore('offlinePunches', { keyPath: 'id', autoIncrement: true });
                    punchStore.createIndex('laborId', 'laborId', { unique: false });
                    punchStore.createIndex('synced', 'synced', { unique: false });
                }

                // Face descriptors cache
                if (!db.objectStoreNames.contains('faceDescriptors')) {
                    db.createObjectStore('faceDescriptors', { keyPath: 'laborId' });
                }

                // Punch locations cache
                if (!db.objectStoreNames.contains('punchLocations')) {
                    db.createObjectStore('punchLocations', { keyPath: 'id' });
                }

                // Settings cache
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }

                console.log('[OfflineStorage] Database upgraded');
            };
        });
    },

    // Save offline punch
    async savePunch(punch) {
        const tx = this.db.transaction('offlinePunches', 'readwrite');
        const store = tx.objectStore('offlinePunches');
        
        const punchData = {
            ...punch,
            synced: false,
            createdAt: new Date().toISOString()
        };

        return new Promise((resolve, reject) => {
            const request = store.add(punchData);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    // Get unsynced punches
    async getUnsyncedPunches() {
        const tx = this.db.transaction('offlinePunches', 'readonly');
        const store = tx.objectStore('offlinePunches');
        const index = store.index('synced');

        return new Promise((resolve, reject) => {
            const request = index.getAll(false);
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    },

    // Mark punch as synced
    async markPunchSynced(id) {
        const tx = this.db.transaction('offlinePunches', 'readwrite');
        const store = tx.objectStore('offlinePunches');

        return new Promise((resolve, reject) => {
            const getRequest = store.get(id);
            getRequest.onsuccess = () => {
                const punch = getRequest.result;
                if (punch) {
                    punch.synced = true;
                    punch.syncedAt = new Date().toISOString();
                    const updateRequest = store.put(punch);
                    updateRequest.onsuccess = () => resolve(true);
                    updateRequest.onerror = () => reject(updateRequest.error);
                } else {
                    resolve(false);
                }
            };
            getRequest.onerror = () => reject(getRequest.error);
        });
    },

    // Delete synced punches older than 7 days
    async cleanupOldPunches() {
        const tx = this.db.transaction('offlinePunches', 'readwrite');
        const store = tx.objectStore('offlinePunches');
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 7);

        return new Promise((resolve, reject) => {
            const request = store.openCursor();
            let deleted = 0;

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const punch = cursor.value;
                    if (punch.synced && new Date(punch.syncedAt) < cutoff) {
                        cursor.delete();
                        deleted++;
                    }
                    cursor.continue();
                } else {
                    console.log(`[OfflineStorage] Cleaned ${deleted} old punches`);
                    resolve(deleted);
                }
            };
            request.onerror = () => reject(request.error);
        });
    },

    // Save face descriptors
    async saveFaceDescriptors(descriptors) {
        const tx = this.db.transaction('faceDescriptors', 'readwrite');
        const store = tx.objectStore('faceDescriptors');

        // Clear old and add new
        await new Promise((resolve, reject) => {
            const clearRequest = store.clear();
            clearRequest.onsuccess = () => resolve();
            clearRequest.onerror = () => reject(clearRequest.error);
        });

        for (const desc of descriptors) {
            await new Promise((resolve, reject) => {
                const request = store.add(desc);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        }

        console.log(`[OfflineStorage] Saved ${descriptors.length} face descriptors`);
    },

    // Get face descriptor by labor ID
    async getFaceDescriptor(laborId) {
        const tx = this.db.transaction('faceDescriptors', 'readonly');
        const store = tx.objectStore('faceDescriptors');

        return new Promise((resolve, reject) => {
            const request = store.get(laborId);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    },

    // Get all face descriptors
    async getAllFaceDescriptors() {
        const tx = this.db.transaction('faceDescriptors', 'readonly');
        const store = tx.objectStore('faceDescriptors');

        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    },

    // Save punch locations
    async savePunchLocations(locations) {
        const tx = this.db.transaction('punchLocations', 'readwrite');
        const store = tx.objectStore('punchLocations');

        // Clear old and add new
        await new Promise((resolve, reject) => {
            const clearRequest = store.clear();
            clearRequest.onsuccess = () => resolve();
            clearRequest.onerror = () => reject(clearRequest.error);
        });

        for (const loc of locations) {
            await new Promise((resolve, reject) => {
                const request = store.add(loc);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        }

        console.log(`[OfflineStorage] Saved ${locations.length} punch locations`);
    },

    // Get all punch locations
    async getPunchLocations() {
        const tx = this.db.transaction('punchLocations', 'readonly');
        const store = tx.objectStore('punchLocations');

        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    },

    // Save setting
    async saveSetting(key, value) {
        const tx = this.db.transaction('settings', 'readwrite');
        const store = tx.objectStore('settings');

        return new Promise((resolve, reject) => {
            const request = store.put({ key, value });
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },

    // Get setting
    async getSetting(key) {
        const tx = this.db.transaction('settings', 'readonly');
        const store = tx.objectStore('settings');

        return new Promise((resolve, reject) => {
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result?.value || null);
            request.onerror = () => reject(request.error);
        });
    }
};