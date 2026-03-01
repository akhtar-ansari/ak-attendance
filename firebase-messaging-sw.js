// Give this SW a scope
self.addEventListener('install', (event) => {
    console.log('[Firebase SW] Installing...');
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('[Firebase SW] Activated');
    event.waitUntil(clients.claim());
});

// Firebase Messaging Service Worker
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyDEydx8zUxauySC_FFWGxL1YnflEEJ7ZWE",
    authDomain: "ak-attendance-87548.firebaseapp.com",
    projectId: "ak-attendance-87548",
    storageBucket: "ak-attendance-87548.firebasestorage.app",
    messagingSenderId: "667155177110",
    appId: "1:667155177110:web:220d117c5b88a78fc66cb7"
});

const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
    console.log('[Firebase] Background message:', payload);

    const title = payload.notification?.title || 'AK Attendance';
    const options = {
        body: payload.notification?.body || 'Tap to view your attendance',
        icon: '/ak-attendance/icon-192.png',
        badge: '/ak-attendance/icon-192.png',
        tag: 'attendance-reminder',
        requireInteraction: true,
        data: {
            url: '/ak-attendance/punch/index.html'
        }
    };

    self.registration.showNotification(title, options);
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    
    const url = event.notification.data?.url || '/ak-attendance/punch/index.html';
    
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then((clientList) => {
            // If app is already open, focus it
            for (const client of clientList) {
                if (client.url.includes('ak-attendance') && 'focus' in client) {
                    return client.focus();
                }
            }
            // Otherwise open new window
            return clients.openWindow(url);
        })
    );

});
