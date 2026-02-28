// AK Attendance - Push Notifications
const PushNotifications = {
    vapidKey: 'BGhCiloi8ik7CEiYyQT7oQ8v9G3pYybKZBscOJaAbjHZB0czdqzsJsiFx91DU5LC-3kCJeIuv1K35lb2Er5bVrE',
    messaging: null,

    // Initialize Firebase Messaging
    async init() {
        try {
            // Check if browser supports notifications
            if (!('Notification' in window)) {
                console.log('[Push] Notifications not supported');
                return false;
            }

            // Check if service worker is supported
            if (!('serviceWorker' in navigator)) {
                console.log('[Push] Service Worker not supported');
                return false;
            }

            // Initialize Firebase
            if (typeof firebase === 'undefined') {
                console.log('[Push] Firebase not loaded');
                return false;
            }

            // Initialize Firebase app if not already
            if (!firebase.apps.length) {
                firebase.initializeApp({
                    apiKey: "AIzaSyDEydx8zUxauySC_FFWGxL1YnflEEJ7ZWE",
                    authDomain: "ak-attendance-87548.firebaseapp.com",
                    projectId: "ak-attendance-87548",
                    storageBucket: "ak-attendance-87548.firebasestorage.app",
                    messagingSenderId: "667155177110",
                    appId: "1:667155177110:web:220d117c5b88a78fc66cb7"
                });
            }

            this.messaging = firebase.messaging();
            console.log('[Push] Firebase initialized');
            return true;
        } catch (error) {
            console.error('[Push] Init error:', error);
            return false;
        }
    },

    // Request notification permission
    async requestPermission() {
        try {
            const permission = await Notification.requestPermission();
            console.log('[Push] Permission:', permission);
            
            if (permission === 'granted') {
                return await this.getToken();
            }
            return null;
        } catch (error) {
            console.error('[Push] Permission error:', error);
            return null;
        }
    },

    // Get FCM token
    async getToken() {
        try {
            // Register service worker
            const registration = await navigator.serviceWorker.register('../firebase-messaging-sw.js', { scope: '/ak-attendance/' });
            console.log('[Push] SW registered:', registration);

            // Get token
            const token = await this.messaging.getToken({
                vapidKey: this.vapidKey,
                serviceWorkerRegistration: registration
            });

            console.log('[Push] Token:', token);
            return token;
        } catch (error) {
            console.error('[Push] Token error:', error);
            return null;
        }
    },

    // Save token to database
    async saveToken(laborId, token) {
        try {
            const { error } = await supabaseClient
                .from('laborers')
                .update({ fcm_token: token })
                .eq('labor_id', laborId);

            if (error) throw error;
            console.log('[Push] Token saved for:', laborId);
            return true;
        } catch (error) {
            console.error('[Push] Save token error:', error);
            return false;
        }
    },

    // Handle foreground messages
    onMessage(callback) {
        if (this.messaging) {
            this.messaging.onMessage((payload) => {
                console.log('[Push] Foreground message:', payload);
                callback(payload);
            });
        }
    }
};
